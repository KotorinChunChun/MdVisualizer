<?php
declare(strict_types=1);

require_once __DIR__ . '/../php/oidc.php';

$failures = 0;
function check(bool $condition, string $message): void
{
    global $failures;
    if (!$condition) {
        $failures++;
        fwrite(STDERR, "FAIL: {$message}\n");
    } else {
        fwrite(STDOUT, "PASS: {$message}\n");
    }
}

function rejects(callable $operation, string $message, ?int $code = null): void
{
    try {
        $operation();
        check(false, $message);
    } catch (Throwable $error) {
        check($code === null || $error->getCode() === $code, $message . ($code === null ? '' : " (code {$error->getCode()})"));
    }
}

function jwt(array $claims, OpenSSLAsymmetricKey $private, string $kid = 'test-key'): string
{
    $header = ['alg' => 'RS256', 'typ' => 'JWT', 'kid' => $kid];
    $encode = static fn(array $value): string => mdv_b64url(json_encode($value, JSON_THROW_ON_ERROR));
    $signing = $encode($header) . '.' . $encode($claims);
    if (!openssl_sign($signing, $signature, $private, OPENSSL_ALGO_SHA256)) {
        throw new RuntimeException('Unable to sign test JWT.');
    }
    return $signing . '.' . mdv_b64url($signature);
}

$fixtureDir = $argv[1] ?? '';
$oidcFixture = $fixtureDir !== '' ? json_decode((string)@file_get_contents($fixtureDir . DIRECTORY_SEPARATOR . 'oidc.json'), true) : null;
$key = is_array($oidcFixture) ? openssl_pkey_get_private((string)($oidcFixture['privatePem'] ?? '')) : false;
if (!$key instanceof OpenSSLAsymmetricKey) throw new RuntimeException('RSA test key fixture could not be loaded.');
$jwk = is_array($oidcFixture['jwk'] ?? null) ? $oidcFixture['jwk'] : [];
$now = 1_700_000_000;
$base = [
    'iss' => 'https://accounts.google.com', 'aud' => 'client-google', 'sub' => 'google-user',
    'nonce' => 'nonce-google', 'iat' => $now, 'exp' => $now + 600,
];
check(is_array(mdv_verify_id_token((string)($oidcFixture['jwt'] ?? jwt($base, $key)), 'google', 'client-google', 'nonce-google', $jwk, $now)), 'OIDC accepts a valid Google RS256 token');
rejects(static fn() => mdv_verify_id_token(jwt(array_replace($base, ['aud' => 'wrong-client']), $key), 'google', 'client-google', 'nonce-google', $jwk, $now), 'OIDC rejects an unexpected audience', 401);
rejects(static fn() => mdv_verify_id_token(jwt(array_replace($base, ['nonce' => 'wrong-nonce']), $key), 'google', 'client-google', 'nonce-google', $jwk, $now), 'OIDC rejects a nonce mismatch', 401);
rejects(static fn() => mdv_verify_id_token(jwt(array_replace($base, ['exp' => $now]), $key), 'google', 'client-google', 'nonce-google', $jwk, $now), 'OIDC rejects an expired token', 401);
rejects(static fn() => mdv_verify_id_token(jwt(array_replace($base, ['iss' => 'https://login.microsoftonline.com/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/v2.0']), $key), 'google', 'client-google', 'nonce-google', $jwk, $now), 'OIDC keeps Google and Microsoft issuer rules separate', 401);
$microsoft = array_replace($base, [
    'iss' => 'https://login.microsoftonline.com/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/v2.0',
    'tid' => 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'aud' => 'client-ms', 'nonce' => 'nonce-ms',
]);
check(is_array(mdv_verify_id_token(jwt($microsoft, $key), 'microsoft', 'client-ms', 'nonce-ms', $jwk, $now)), 'OIDC accepts a valid Microsoft tenant token');

$tmp = sys_get_temp_dir() . DIRECTORY_SEPARATOR . 'mdv-php-' . bin2hex(random_bytes(6));
mkdir($tmp . '/owner-a', 0700, true);
mkdir($tmp . '/owner-b', 0700, true);
$id = str_repeat('a', 32);
$item = ['id' => $id, 'created' => $now, 'expires' => $now + 600, 'bytes' => 10];
file_put_contents($tmp . '/owner-a/' . $id . '.json', json_encode($item, JSON_THROW_ON_ERROR));
file_put_contents($tmp . '/owner-a/' . $id . '.zip', 'encrypted');
$userA = ['owner' => str_repeat('a', 64)];
$userB = ['owner' => str_repeat('b', 64)];
check(mdv_owner_dir($tmp, $userA) !== mdv_owner_dir($tmp, $userB), 'owner directories are isolated');
rejects(static fn() => mdv_item($tmp, $userB, $id), 'item lookup cannot cross owner directories', 404);
$old = $id;
file_put_contents($tmp . '/owner-a/' . $old . '.json', json_encode(['id' => $old, 'expires' => $now - 1], JSON_THROW_ON_ERROR));
file_put_contents($tmp . '/owner-a/' . $old . '.zip', 'expired');
mdv_cleanup($tmp, $now);
check(!is_file($tmp . '/owner-a/' . $old . '.json') && !is_file($tmp . '/owner-a/' . $old . '.zip'), 'cleanup removes expired metadata and ZIP');

$_SERVER['REQUEST_METHOD'] = 'GET';
$_SERVER['HTTP_X_CSRF_TOKEN'] = '';
session_save_path($tmp);
session_id('mdv-test-session');
mdv_session();
$csrf = (string)$_SESSION['csrf'];
rejects(static fn() => mdv_csrf(), 'CSRF rejects non-POST requests', 403);
$_SERVER['REQUEST_METHOD'] = 'POST';
$_SERVER['HTTP_X_CSRF_TOKEN'] = $csrf;
try { mdv_csrf(); check(true, 'CSRF accepts the session token on POST'); } catch (Throwable $error) { check(false, 'CSRF accepts the session token on POST'); }
session_write_close();

$windowsPath = $tmp . DIRECTORY_SEPARATOR . 'storage';
putenv('MDVISUALIZER_CONFIG=' . $tmp . '/config.json');
file_put_contents($tmp . '/config.json', json_encode(['storage_dir' => $windowsPath], JSON_THROW_ON_ERROR));
check(mdv_storage_root() === realpath($windowsPath), 'Windows absolute storage paths are accepted outside the public root');

if ($fixtureDir !== '' && is_dir($fixtureDir)) {
    $encrypted = file_get_contents($fixtureDir . DIRECTORY_SEPARATOR . 'encrypted.zip');
    if (!is_string($encrypted)) throw new RuntimeException('Encrypted ZIP fixture missing.');
    try { mdv_validate_zip($encrypted); check(true, 'ZIP validator accepts zip.js AES-256 fixture'); } catch (Throwable $error) { check(false, 'ZIP validator accepts zip.js AES-256 fixture: ' . $error->getMessage()); }
    foreach (['plain.zip' => 'plain ZIP', 'tampered.zip' => 'tampered ZIP', 'traversal.zip' => 'ZIP path traversal', 'oversized.zip' => 'expanded-size limit'] as $file => $label) {
        $bytes = file_get_contents($fixtureDir . DIRECTORY_SEPARATOR . $file);
        if (!is_string($bytes)) throw new RuntimeException("ZIP fixture missing: {$file}");
        rejects(static fn() => mdv_validate_zip($bytes), "ZIP validator rejects {$label}");
    }
}

if (PHP_SAPI === 'cli') {
    foreach (glob($tmp . '/owner-a/*') ?: [] as $path) @unlink($path);
    foreach (glob($tmp . '/owner-b/*') ?: [] as $path) @unlink($path);
    @rmdir($tmp . '/owner-a'); @rmdir($tmp . '/owner-b'); @unlink($tmp . '/config.json'); @rmdir($tmp);
}
exit($failures === 0 ? 0 : 1);
