<?php
declare(strict_types=1);

require_once __DIR__ . '/site-auth-bootstrap.php';
require_once __DIR__ . '/../php/lib.php';

$failures = 0;
function site_auth_check(bool $condition, string $label): void {
    global $failures;
    if ($condition) { echo "PASS: {$label}\n"; return; }
    $failures++; echo "FAIL: {$label}\n";
}
function site_auth_rejects(callable $operation, int $status, string $label): void {
    try { $operation(); site_auth_check(false, $label); }
    catch (RuntimeException $error) { site_auth_check($error->getCode() === $status, $label); }
}

$tmp = sys_get_temp_dir() . '/mdv-site-auth-' . bin2hex(random_bytes(6));
mkdir($tmp, 0700, true);
session_save_path($tmp);
session_id('site-auth-unit');
$_SESSION = [];
mdv_session();
site_auth_check(session_name() === SITE_AUTH_TEST_SESSION, '共通サイトのセッション名を使う');
site_auth_check(isset($_SESSION['mdv_csrf']) && !isset($_SESSION['csrf']), 'MdVisualizerのCSRF値を共有セッション内で分離する');
$_SESSION['google_user_id'] = 'active-user';
$user = mdv_user();
site_auth_check($user['owner'] === hash('sha256', "google\0accounts.google.com\0shared-active-subject"), '従来Google OIDCと同じ保管所有者キーを導出する');
site_auth_check($user['provider'] === 'google' && $user['name'] === '共有ログイン利用者', '共有Google利用者をAPI表示用に正規化する');
$_SESSION['google_user_id'] = 'pending-user';
site_auth_check(mdv_user()['name'] === '承認待ち利用者', '承認待ちの共有利用者を利用可能にする');
$_SESSION['google_user_id'] = 'suspended-user';
site_auth_rejects(static fn() => mdv_user(), 403, '停止中の共有利用者を拒否する');
unset($_SESSION['google_user_id']);
site_auth_rejects(static fn() => mdv_user(), 401, '共有ログインなしを拒否する');
$_SESSION['google_user_id'] = 'active-user';
$_SERVER['REQUEST_METHOD'] = 'POST';
$_SERVER['HTTP_X_CSRF_TOKEN'] = (string)$_SESSION['mdv_csrf'];
try { mdv_csrf(); site_auth_check(true, '分離したCSRF値で変更操作を許可する'); } catch (Throwable) { site_auth_check(false, '分離したCSRF値で変更操作を許可する'); }
$_SERVER['HTTP_X_CSRF_TOKEN'] = str_repeat('0', 64);
site_auth_rejects(static fn() => mdv_csrf(), 403, '共通セッション内でも不正CSRF値を拒否する');
session_write_close();
@unlink($tmp . '/sess_site-auth-unit'); @rmdir($tmp);
exit($failures === 0 ? 0 : 1);
