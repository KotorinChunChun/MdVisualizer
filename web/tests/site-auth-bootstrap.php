<?php
declare(strict_types=1);

// 認証情報を持たずに、Website共通認証との境界だけを試すための代用品。
const SITE_AUTH_TEST_SESSION = 'site_auth_test';

function site_auth_start_session(): void {
    if (session_status() === PHP_SESSION_ACTIVE) return;
    session_name(SITE_AUTH_TEST_SESSION);
    session_start();
}

function site_auth_current_user(): ?array {
    site_auth_start_session();
    return match ((string)($_SESSION['google_user_id'] ?? '')) {
        'active-user' => ['google_sub' => 'shared-active-subject', 'name' => '共有ログイン利用者', 'status' => 'active'],
        'pending-user' => ['google_sub' => 'shared-pending-subject', 'name' => '承認待ち利用者', 'status' => 'pending'],
        'suspended-user' => ['google_sub' => 'shared-suspended-subject', 'name' => '停止中利用者', 'status' => 'suspended'],
        default => null,
    };
}

function site_auth_is_configured(): bool { return true; }

function site_auth_login_path(string $returnTo): string {
    return '/auth/google/login.php?return_to=' . rawurlencode($returnTo);
}

function site_auth_logout_path(string $returnTo): string {
    return '/auth/logout.php?return_to=' . rawurlencode($returnTo);
}
