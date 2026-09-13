<?php
declare(strict_types=1);
require_once __DIR__ . '/oidc.php';
header('Content-Type: text/html; charset=UTF-8');
header('Cache-Control: no-store');
header('X-Content-Type-Options: nosniff');
header('Referrer-Policy: no-referrer');
header('X-Frame-Options: SAMEORIGIN');
try {
    mdv_session();
    if (!empty(mdv_config()['storage_dir'])) mdv_storage_locked(static fn(string $root): bool => true);
    $signedIn = false;
    try { mdv_user(); $signedIn = true; } catch (RuntimeException $error) { if ($error->getCode() !== 401) throw $error; }
    if (!$signedIn) {
        $providers = [];
        foreach (['google' => 'Google', 'microsoft' => 'Microsoft'] as $provider => $label) {
            try { mdv_provider($provider); mdv_callback_url(); $providers[$provider] = $label; } catch (Throwable) {}
        }
        if (!$providers) http_response_code(503);
        echo '<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>MdVisualizer Web — サインイン</title><style>body{font:1rem/1.7 system-ui,sans-serif;max-width:38rem;margin:12vh auto;padding:1.5rem;background:#f5f7fa;color:#18212f}a{display:block;margin:1rem 0;padding:.8rem;border:1px solid #6584a8;border-radius:.4rem;color:#075cab;background:white}</style></head><body><h1>MdVisualizer Web</h1><p>GoogleまたはMicrosoftでサインインして利用してください。</p>';
        foreach ($providers as $provider => $label) echo '<a href="api.php?action=login&amp;provider=' . $provider . '">' . $label . 'でサインイン</a>';
        if (!$providers) echo '<p>サインイン設定を準備しています。</p>';
        echo '<p>文書や画像は、暗号化一時保管を選んだ時だけサーバーに送信します。</p></body></html>';
        exit;
    }
    if (!is_file(__DIR__ . '/app.html')) throw new RuntimeException('アプリの配備を準備しています。', 503);
    readfile(__DIR__ . '/app.html');
} catch (Throwable) {
    http_response_code(503);
    echo '<!doctype html><html lang="ja"><meta charset="utf-8"><title>MdVisualizer Web</title><h1>MdVisualizer Web</h1><p>アプリを準備しています。しばらくしてから開き直してください。</p></html>';
}
