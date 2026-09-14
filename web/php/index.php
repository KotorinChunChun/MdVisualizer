<?php
declare(strict_types=1);
require_once __DIR__ . '/lib.php';
header('Content-Type: text/html; charset=UTF-8');
header('Cache-Control: no-store');
header('X-Content-Type-Options: nosniff');
header('Referrer-Policy: no-referrer');
header('X-Frame-Options: SAMEORIGIN');
try {
    mdv_user();
    if (!is_file(__DIR__ . '/app.html')) throw new RuntimeException('アプリの配備を準備しています。', 503);
    readfile(__DIR__ . '/app.html');
} catch (Throwable $error) {
    $status = in_array($error->getCode(), [401, 403], true) ? $error->getCode() : 503;
    http_response_code($status === 401 ? 200 : $status);
    echo '<!doctype html><html lang="ja"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>MdVisualizer Web</title><body><h1>MdVisualizer Web</h1>';
    if ($status === 401) {
        $login = htmlspecialchars(site_auth_login_path(mdv_base_path() . 'index.php'), ENT_QUOTES, 'UTF-8');
        echo '<p>サイトのGoogleログインで利用できます。メニューですでにサインインしている場合は、そのログイン状態を使用します。</p><p><a href="' . $login . '">Googleでサイトにログイン</a></p>';
    } elseif ($status === 403) {
        echo '<p>このアカウントは利用できません。サイトの利用状態を確認してください。</p>';
    } else {
        echo '<p>アプリを準備しています。しばらくしてから開き直してください。</p>';
    }
    echo '<p><a href="/test/">テストメニュー</a> · <a href="/privacy.html">プライバシーポリシー</a></p></body></html>';
}
