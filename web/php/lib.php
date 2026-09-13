<?php
declare(strict_types=1);

// 公開領域には設定値・利用者データを置かない。
function mdv_config(): array {
    static $config;
    if ($config !== null) return $config;
    $path = getenv('MDVISUALIZER_CONFIG') ?: dirname((string)($_SERVER['DOCUMENT_ROOT'] ?? __DIR__)) . '/private/mdvisualizer.json';
    $config = is_file($path) ? json_decode((string)file_get_contents($path), true, 32, JSON_THROW_ON_ERROR) : [];
    if (!is_array($config)) throw new RuntimeException('設定を読み込めません。');
    return $config;
}

function mdv_session(): void {
    if (session_status() === PHP_SESSION_ACTIVE) return;
    ini_set('session.use_strict_mode', '1');
    ini_set('session.use_only_cookies', '1');
    session_name('mdvisualizer_session');
    session_set_cookie_params(['lifetime' => 0, 'path' => mdv_base_path(), 'secure' => true, 'httponly' => true, 'samesite' => 'Lax']);
    session_start();
    if (!isset($_SESSION['csrf'])) $_SESSION['csrf'] = bin2hex(random_bytes(32));
}

function mdv_base_path(): string {
    $path = str_replace('\\', '/', dirname((string)($_SERVER['SCRIPT_NAME'] ?? '/test/mdvisualizer/api.php')));
    return rtrim($path, '/') . '/';
}

function mdv_user(): array {
    mdv_session();
    $user = $_SESSION['user'] ?? null;
    if (!is_array($user) || (int)($user['expires'] ?? 0) <= time()) throw new RuntimeException('サインインしてください。', 401);
    return $user;
}

function mdv_csrf(): void {
    mdv_session();
    if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST' || !hash_equals($_SESSION['csrf'], (string)($_SERVER['HTTP_X_CSRF_TOKEN'] ?? ''))) {
        throw new RuntimeException('操作を確認できません。画面を開き直してください。', 403);
    }
}

function mdv_storage_root(): string {
    $configured = (string)(mdv_config()['storage_dir'] ?? '');
    if ($configured === '' || !(str_starts_with($configured, '/') || (PHP_OS_FAMILY === 'Windows' && preg_match('~\A[A-Za-z]:[/\\\\]~', $configured)))) throw new RuntimeException('一時保管先が未設定です。', 503);
    if (!is_dir($configured) && !mkdir($configured, 0700, true) && !is_dir($configured)) throw new RuntimeException('保管先を準備できません。');
    $root = realpath($configured);
    $public = realpath((string)($_SERVER['DOCUMENT_ROOT'] ?? __DIR__));
    if ($root === false || ($public !== false && ($root === $public || str_starts_with($root, $public . DIRECTORY_SEPARATOR)))) throw new RuntimeException('保管先は公開領域の外へ設定してください。', 503);
    return $root;
}

function mdv_storage_locked(callable $operation): mixed {
    $root = mdv_storage_root();
    $lock = fopen($root . '/.lock', 'c');
    if (!$lock || !flock($lock, LOCK_EX)) throw new RuntimeException('保管処理を開始できません。');
    try {
        mdv_cleanup($root, time());
        return $operation($root);
    } finally { flock($lock, LOCK_UN); fclose($lock); }
}

function mdv_cleanup(string $root, int $now): void {
    foreach (glob($root . '/*/*.json') ?: [] as $file) {
        $item = json_decode((string)@file_get_contents($file), true);
        if (!is_array($item) || (int)($item['expires'] ?? 0) <= $now) {
            @unlink(substr($file, 0, -5) . '.zip');
            @unlink($file);
        }
    }
    foreach (glob($root . '/*/*') ?: [] as $file) {
        if (str_ends_with($file, '.part') && (int)@filemtime($file) < $now - 3600) @unlink($file);
        if (str_ends_with($file, '.zip') && !is_file(substr($file, 0, -4) . '.json') && (int)@filemtime($file) < $now - 3600) @unlink($file);
    }
    foreach (glob($root . '/*', GLOB_ONLYDIR) ?: [] as $dir) @rmdir($dir); // 空フォルダーだけ。
}

function mdv_item_id(string $id): string {
    if (!preg_match('/\A[a-f0-9]{32}\z/', $id)) throw new RuntimeException('保管項目が見つかりません。', 404);
    return $id;
}

function mdv_owner_dir(string $root, array $user): string {
    $owner = (string)($user['owner'] ?? '');
    if (!preg_match('/\A[a-f0-9]{64}\z/', $owner)) throw new RuntimeException('サインインしてください。', 401);
    return $root . '/' . $owner;
}

function mdv_item(string $root, array $user, string $id): array {
    $base = mdv_owner_dir($root, $user) . '/' . mdv_item_id($id);
    $item = is_file($base . '.json') ? json_decode((string)file_get_contents($base . '.json'), true) : null;
    if (!is_array($item) || (int)($item['expires'] ?? 0) <= time() || !is_file($base . '.zip')) throw new RuntimeException('保管期限が過ぎたか、項目が見つかりません。', 404);
    return [$base, $item];
}

// ブラウザーが生成した暗号化ZIPの外形だけを検査する。復号鍵は受け取らない。
function mdv_validate_zip(string $bytes): void {
    $length = strlen($bytes);
    if ($length < 22 || $length > 32 * 1024 * 1024) throw new RuntimeException('暗号化ZIPは32MiB以内にしてください。', 413);
    $end = strrpos($bytes, "PK\x05\x06");
    if ($end === false || $length - $end > 65557 || $end + 22 > $length) throw new RuntimeException('ZIP形式を確認できません。', 400);
    $e = unpack('vdisk/vstart/ventriesDisk/ventries/Vsize/Voffset/vcomment', substr($bytes, $end + 4, 18));
    if (!$e || $e['disk'] !== 0 || $e['start'] !== 0 || $e['entriesDisk'] !== $e['entries'] || $e['entries'] < 1 || $e['entries'] > 1000 || $end + 22 + $e['comment'] !== $length || $e['offset'] + $e['size'] !== $end) throw new RuntimeException('未対応のZIP構成です。', 400);
    $offset = $e['offset']; $total = 0; $names = [];
    for ($i = 0; $i < $e['entries']; $i++) {
        if (substr($bytes, $offset, 4) !== "PK\x01\x02" || $offset + 46 > $end) throw new RuntimeException('ZIP構造が不正です。', 400);
        $h = unpack('vflags/vmethod', substr($bytes, $offset + 8, 4));
        $sizes = unpack('Vcompressed/Vplain/vname/vextra/vcomment', substr($bytes, $offset + 20, 14));
        $local = unpack('Voffset', substr($bytes, $offset + 42, 4))['offset'];
        $name = substr($bytes, $offset + 46, $sizes['name']);
        $next = $offset + 46 + $sizes['name'] + $sizes['extra'] + $sizes['comment'];
        if ($next > $end || $name === '' || preg_match('~(^[/\\\\]|(^|[/\\\\])\.\.([/\\\\]|$)|[\x00-\x1f:]|\\\\)~', $name) || isset($names[$name])) throw new RuntimeException('ZIP内のパスが不正です。', 400);
        $names[$name] = true;
        $extra = substr($bytes, $offset + 46 + $sizes['name'], $sizes['extra']);
        $aes = false;
        for ($p = 0; $p + 4 <= strlen($extra);) {
            $field = unpack('vid/vlength', substr($extra, $p, 4));
            if ($p + 4 + $field['length'] > strlen($extra)) throw new RuntimeException('ZIP拡張情報が不正です。', 400);
            if ($field['id'] === 0x9901 && $field['length'] === 7) {
                $data = substr($extra, $p + 4, 7);
                $aes = substr($data, 2, 2) === 'AE' && ord($data[4]) === 3 && in_array(unpack('v', substr($data, 0, 2))[1], [1,2], true);
            }
            $p += 4 + $field['length'];
        }
        if (($h['flags'] & 1) !== 1 || $h['method'] !== 99 || !$aes) throw new RuntimeException('すべての項目をAES-256で暗号化してください。', 400);
        if ($local + 30 > $e['offset'] || substr($bytes, $local, 4) !== "PK\x03\x04") throw new RuntimeException('ZIP内のデータ位置が不正です。', 400);
        $lh = unpack('vflags/vmethod', substr($bytes, $local + 6, 4));
        $ln = unpack('vname/vextra', substr($bytes, $local + 26, 4));
        if ($lh !== $h || substr($bytes, $local + 30, $ln['name']) !== $name || $local + 30 + $ln['name'] + $ln['extra'] + $sizes['compressed'] > $e['offset']) throw new RuntimeException('ZIPの項目情報が一致しません。', 400);
        $total += $sizes['plain'];
        if ($total > 128 * 1024 * 1024) throw new RuntimeException('ZIPの展開後容量が上限を超えています。', 413);
        $offset = $next;
    }
    if ($offset !== $end) throw new RuntimeException('ZIPの終端が不正です。', 400);
}

function mdv_json(array $data, int $status = 200): never {
    http_response_code($status);
    header('Content-Type: application/json; charset=UTF-8');
    header('Cache-Control: no-store');
    header('X-Content-Type-Options: nosniff');
    echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR);
    exit;
}
