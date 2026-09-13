<?php
declare(strict_types=1);
require_once __DIR__ . '/oidc.php';
header('Cache-Control: no-store');
header('X-Content-Type-Options: nosniff');
header('Referrer-Policy: no-referrer');

try {
    mdv_session();
    $action = (string)($_GET['action'] ?? 'session');
    if (in_array($action, ['session', 'login', 'callback', 'list', 'download'], true) && ($_SERVER['REQUEST_METHOD'] ?? '') !== 'GET') throw new RuntimeException('この操作はGETで実行してください。', 405);
    if ($action === 'login') mdv_login((string)($_GET['provider'] ?? ''));
    if ($action === 'callback') mdv_callback();
    if ($action === 'logout') {
        mdv_csrf(); $_SESSION = []; session_regenerate_id(true); $_SESSION['csrf'] = bin2hex(random_bytes(32)); mdv_json(['ok' => true]);
    }
    if ($action === 'session') {
        $providers = [];
        foreach (['google', 'microsoft'] as $provider) { try { mdv_provider($provider); mdv_callback_url(); $providers[] = $provider; } catch (Throwable) {} }
        $user = null;
        try { $u = mdv_user(); $user = ['name' => $u['name'], 'provider' => $u['provider']]; } catch (RuntimeException) {}
        $storage = !empty(mdv_config()['storage_dir']);
        if ($storage) mdv_storage_locked(static fn(string $root): bool => true);
        mdv_json(['user' => $user, 'csrf' => $_SESSION['csrf'], 'providers' => $providers, 'storageAvailable' => $storage, 'limits' => ['uploadBytes' => 32 * 1024 * 1024, 'retentionDays' => 10]]);
    }
    $user = mdv_user();
    if ($action === 'list') {
        $items = mdv_storage_locked(static function(string $root) use ($user): array {
            $items = [];
            foreach (glob(mdv_owner_dir($root, $user) . '/*.json') ?: [] as $path) {
                $item = json_decode((string)file_get_contents($path), true);
                if (is_array($item) && $item['expires'] > time()) $items[] = $item;
            }
            usort($items, static fn(array $a, array $b): int => $b['created'] <=> $a['created']);
            return $items;
        }); mdv_json(['items' => $items]);
    }
    if ($action === 'store') {
        mdv_csrf();
        if (strtolower(trim(explode(';', (string)($_SERVER['CONTENT_TYPE'] ?? ''))[0])) !== 'application/zip') throw new RuntimeException('暗号化ZIPを送信してください。', 415);
        if ((int)($_SERVER['CONTENT_LENGTH'] ?? 0) > 32 * 1024 * 1024) throw new RuntimeException('送信容量が上限を超えています。', 413);
        $input = fopen('php://input', 'rb');
        $bytes = $input ? stream_get_contents($input, 32 * 1024 * 1024 + 1) : false;
        if ($input) fclose($input);
        if ($bytes === false) throw new RuntimeException('ZIPを受信できません。', 400);
        mdv_validate_zip($bytes);
        $item = mdv_storage_locked(static function(string $root) use ($user, $bytes): array {
            $dir = mdv_owner_dir($root, $user); $size = 0; $global = 0; $count = 0;
            foreach (glob($root . '/*/*.zip') ?: [] as $file) { $n = (int)filesize($file); $global += $n; if (dirname($file) === $dir) { $size += $n; $count++; } }
            $config = mdv_config();
            if ($count >= (int)($config['max_items_per_user'] ?? 20) || $size + strlen($bytes) > (int)($config['max_bytes_per_user'] ?? 100 * 1024 * 1024) || $global + strlen($bytes) > (int)($config['max_bytes_total'] ?? 1024 * 1024 * 1024)) throw new RuntimeException('一時保管の容量または件数の上限です。不要な保管物を削除してください。', 413);
            if (!is_dir($dir) && !mkdir($dir, 0700) && !is_dir($dir)) throw new RuntimeException('保管先を準備できません。');
            $id = bin2hex(random_bytes(16)); $base = $dir . '/' . $id; $now = time();
            $item = ['id' => $id, 'name' => 'MdVisualizer-' . gmdate('Ymd-His', $now) . '.zip', 'created' => $now, 'expires' => $now + 10 * 86400, 'bytes' => strlen($bytes)];
            try {
                if (file_put_contents($base . '.part', $bytes, LOCK_EX) !== strlen($bytes)) throw new RuntimeException('ZIPを保存できません。');
                chmod($base . '.part', 0600);
                if (!rename($base . '.part', $base . '.zip')) throw new RuntimeException('ZIPを確定できません。');
                $json = json_encode($item, JSON_THROW_ON_ERROR);
                if (file_put_contents($base . '.json', $json, LOCK_EX) !== strlen($json)) throw new RuntimeException('保管情報を保存できません。');
                chmod($base . '.json', 0600);
            } catch (Throwable $error) { @unlink($base . '.part'); @unlink($base . '.zip'); @unlink($base . '.json'); throw $error; }
            return $item;
        }); mdv_json(['item' => $item], 201);
    }
    if ($action === 'download') {
        [$bytes, $item] = mdv_storage_locked(static function(string $root) use ($user): array { [$base, $item] = mdv_item($root, $user, (string)($_GET['id'] ?? '')); $bytes = file_get_contents($base . '.zip'); if ($bytes === false) throw new RuntimeException('保管物を読み込めません。'); return [$bytes, $item]; });
        header('Content-Type: application/zip'); header('Content-Disposition: attachment; filename="' . $item['name'] . '"'); header('Content-Length: ' . strlen($bytes)); echo $bytes; exit;
    }
    if ($action === 'delete') {
        mdv_csrf();
        mdv_storage_locked(static function(string $root) use ($user): void { [$base] = mdv_item($root, $user, (string)($_GET['id'] ?? '')); if (!unlink($base . '.zip')) throw new RuntimeException('保管物を削除できません。'); @unlink($base . '.json'); });
        mdv_json(['ok' => true]);
    }
    throw new RuntimeException('操作が見つかりません。', 404);
} catch (Throwable $error) {
    $status = $error instanceof RuntimeException && in_array($error->getCode(), [400,401,403,404,405,413,415,429,502,503], true) ? $error->getCode() : 500;
    mdv_json(['error' => $status === 500 ? '処理に失敗しました。内容を保持したまま、しばらくして再試行してください。' : $error->getMessage()], $status);
}
