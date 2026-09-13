<?php
declare(strict_types=1);
require_once __DIR__ . '/lib.php';

function mdv_provider(string $name): array {
    $settings = mdv_config()['providers'][$name] ?? null;
    if (!in_array($name, ['google', 'microsoft'], true) || !is_array($settings) || empty($settings['client_id']) || empty($settings['client_secret'])) throw new RuntimeException('このサインインはまだ設定されていません。', 503);
    return $settings + ($name === 'google' ? [
        'authorize' => 'https://accounts.google.com/o/oauth2/v2/auth',
        'token' => 'https://oauth2.googleapis.com/token',
        'jwks' => 'https://www.googleapis.com/oauth2/v3/certs',
    ] : [
        'authorize' => 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
        'token' => 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
        'jwks' => 'https://login.microsoftonline.com/common/discovery/v2.0/keys',
    ]);
}

function mdv_callback_url(): string {
    $url = (string)(mdv_config()['callback_url'] ?? '');
    $parts = parse_url($url);
    if (!$parts || ($parts['scheme'] ?? '') !== 'https' || empty($parts['host']) || isset($parts['user']) || isset($parts['fragment'])) throw new RuntimeException('SSOの戻り先URLが未設定です。', 503);
    return $url;
}

function mdv_http_json(string $url, ?array $form = null): array {
    $allowed = ['accounts.google.com', 'oauth2.googleapis.com', 'www.googleapis.com', 'login.microsoftonline.com'];
    if (parse_url($url, PHP_URL_SCHEME) !== 'https' || !in_array(parse_url($url, PHP_URL_HOST), $allowed, true)) throw new RuntimeException('認証接続先が不正です。');
    if (!function_exists('curl_init')) throw new RuntimeException('PHPのcURL拡張が必要です。', 503);
    $ch = curl_init($url); $body = '';
    curl_setopt_array($ch, [CURLOPT_FOLLOWLOCATION => false, CURLOPT_TIMEOUT => 20, CURLOPT_CONNECTTIMEOUT => 10, CURLOPT_PROTOCOLS => CURLPROTO_HTTPS, CURLOPT_SSL_VERIFYPEER => true, CURLOPT_SSL_VERIFYHOST => 2, CURLOPT_HTTPHEADER => ['Accept: application/json'], CURLOPT_WRITEFUNCTION => static function($curl, string $part) use (&$body): int { if (strlen($body) + strlen($part) > 1024 * 1024) return 0; $body .= $part; return strlen($part); }]);
    if ($form !== null) curl_setopt_array($ch, [CURLOPT_POST => true, CURLOPT_POSTFIELDS => http_build_query($form)]);
    $result = curl_exec($ch); $status = curl_getinfo($ch, CURLINFO_RESPONSE_CODE); curl_close($ch);
    if ($result === false || $status !== 200) throw new RuntimeException('認証サービスとの通信に失敗しました。', 502);
    $data = json_decode($body, true, 32, JSON_THROW_ON_ERROR);
    if (!is_array($data)) throw new RuntimeException('認証応答を確認できません。');
    return $data;
}

function mdv_b64url(string $value): string { return rtrim(strtr(base64_encode($value), '+/', '-_'), '='); }
function mdv_unb64(string $value): string {
    if (!preg_match('/\A[A-Za-z0-9_-]+\z/', $value)) throw new RuntimeException('認証情報が不正です。', 401);
    $decoded = base64_decode(strtr($value, '-_', '+/'), true);
    if ($decoded === false) throw new RuntimeException('認証情報が不正です。', 401);
    return $decoded;
}
function mdv_der(int $tag, string $value): string {
    $n = strlen($value); $size = $n < 128 ? chr($n) : '';
    if ($n >= 128) { $raw = ''; while ($n > 0) { $raw = chr($n & 255) . $raw; $n >>= 8; } $size = chr(128 | strlen($raw)) . $raw; }
    return chr($tag) . $size . $value;
}
function mdv_rsa_pem(array $key): string {
    $integer = static function(string $v): string { $raw = ltrim(mdv_unb64($v), "\0"); if ($raw === '') $raw = "\0"; if (ord($raw[0]) & 128) $raw = "\0" . $raw; return mdv_der(2, $raw); };
    $rsa = mdv_der(0x30, $integer((string)$key['n']) . $integer((string)$key['e']));
    $spki = mdv_der(0x30, hex2bin('300d06092a864886f70d0101010500') . mdv_der(3, "\0" . $rsa));
    return "-----BEGIN PUBLIC KEY-----\n" . chunk_split(base64_encode($spki), 64, "\n") . "-----END PUBLIC KEY-----\n";
}

function mdv_verify_id_token(string $jwt, string $provider, string $clientId, string $nonce, array $jwks, ?int $now = null): array {
    if (strlen($jwt) > 32768) throw new RuntimeException('認証情報が大きすぎます。', 401);
    $parts = explode('.', $jwt);
    if (count($parts) !== 3) throw new RuntimeException('認証情報が不正です。', 401);
    $header = json_decode(mdv_unb64($parts[0]), true, 16, JSON_THROW_ON_ERROR);
    $claims = json_decode(mdv_unb64($parts[1]), true, 16, JSON_THROW_ON_ERROR);
    if (!is_array($header) || !is_array($claims) || ($header['alg'] ?? '') !== 'RS256' || !is_string($header['kid'] ?? null) || isset($header['crit'])) throw new RuntimeException('認証署名の形式が不正です。', 401);
    $iss = (string)($claims['iss'] ?? '');
    if ($provider === 'google') {
        if (!in_array($iss, ['https://accounts.google.com', 'accounts.google.com'], true)) throw new RuntimeException('認証元が一致しません。', 401);
    } elseif ($provider === 'microsoft') {
        $tid = (string)($claims['tid'] ?? '');
        if (!preg_match('/\A[0-9a-f-]{36}\z/i', $tid) || $iss !== 'https://login.microsoftonline.com/' . $tid . '/v2.0') throw new RuntimeException('認証元が一致しません。', 401);
    } else throw new RuntimeException('認証元が不正です。', 401);
    $valid = false;
    foreach ($jwks['keys'] ?? [] as $key) {
        if (($key['kid'] ?? '') !== $header['kid'] || ($key['kty'] ?? '') !== 'RSA' || ($key['use'] ?? 'sig') !== 'sig' || ($key['alg'] ?? 'RS256') !== 'RS256' || !isset($key['n'], $key['e'])) continue;
        if ($provider === 'microsoft' && isset($key['issuer']) && str_replace('{tenantid}', (string)$claims['tid'], $key['issuer']) !== $iss) continue;
        $valid = openssl_verify($parts[0] . '.' . $parts[1], mdv_unb64($parts[2]), mdv_rsa_pem($key), OPENSSL_ALGO_SHA256) === 1;
        if ($valid) break;
    }
    $now ??= time();
    $aud = $claims['aud'] ?? '';
    $audOk = is_string($aud) ? hash_equals($clientId, $aud) : is_array($aud) && in_array($clientId, $aud, true) && ($claims['azp'] ?? '') === $clientId;
    if (!$valid || !$audOk || (isset($claims['azp']) && $claims['azp'] !== $clientId) || !is_numeric($claims['exp'] ?? null) || (int)$claims['exp'] <= $now || (int)($claims['nbf'] ?? 0) > $now + 60 || (int)($claims['iat'] ?? 0) > $now + 60 || !is_string($claims['sub'] ?? null) || $claims['sub'] === '' || strlen($claims['sub']) > 255 || !is_string($claims['nonce'] ?? null) || !hash_equals($nonce, $claims['nonce'])) throw new RuntimeException('サインイン情報を検証できません。', 401);
    return $claims;
}

function mdv_login(string $name): never {
    mdv_session(); $p = mdv_provider($name);
    $state = mdv_b64url(random_bytes(32)); $verifier = mdv_b64url(random_bytes(48)); $nonce = mdv_b64url(random_bytes(32));
    $_SESSION['oidc'] = ['provider' => $name, 'state' => $state, 'verifier' => $verifier, 'nonce' => $nonce, 'created' => time()];
    $params = ['client_id' => $p['client_id'], 'redirect_uri' => mdv_callback_url(), 'response_type' => 'code', 'scope' => 'openid profile email', 'state' => $state, 'nonce' => $nonce, 'code_challenge' => mdv_b64url(hash('sha256', $verifier, true)), 'code_challenge_method' => 'S256', 'prompt' => 'select_account'];
    header('Cache-Control: no-store'); header('Location: ' . $p['authorize'] . '?' . http_build_query($params)); exit;
}

function mdv_callback(): never {
    mdv_session(); $pending = $_SESSION['oidc'] ?? null; unset($_SESSION['oidc']);
    if (!is_array($pending) || time() - (int)$pending['created'] > 600 || !hash_equals((string)$pending['state'], (string)($_GET['state'] ?? '')) || !is_string($_GET['code'] ?? null) || strlen($_GET['code']) > 8192) throw new RuntimeException('サインインをやり直してください。', 401);
    $p = mdv_provider($pending['provider']);
    $token = mdv_http_json($p['token'], ['grant_type' => 'authorization_code', 'client_id' => $p['client_id'], 'client_secret' => $p['client_secret'], 'redirect_uri' => mdv_callback_url(), 'code' => $_GET['code'], 'code_verifier' => $pending['verifier']]);
    $claims = mdv_verify_id_token((string)($token['id_token'] ?? ''), $pending['provider'], $p['client_id'], $pending['nonce'], mdv_http_json($p['jwks']));
    session_regenerate_id(true);
    $_SESSION = ['csrf' => bin2hex(random_bytes(32)), 'user' => ['owner' => hash('sha256', $pending['provider'] . "\0" . str_replace('https://', '', (string)$claims['iss']) . "\0" . $claims['sub']), 'provider' => $pending['provider'], 'name' => mb_substr((string)($claims['name'] ?? '利用者'), 0, 100), 'expires' => time() + 8 * 3600]];
    header('Cache-Control: no-store'); header('Location: ' . mdv_base_path()); exit;
}
