<?php
declare(strict_types=1);
header('Content-Type: text/html; charset=UTF-8');
header('Cache-Control: no-store');
header('X-Content-Type-Options: nosniff');
header('Referrer-Policy: same-origin');
header('X-Frame-Options: SAMEORIGIN');
if (!is_file(__DIR__ . '/app.html')) { http_response_code(503); echo '<!doctype html><html lang="ja"><meta charset="utf-8"><title>MdVisualizer Web</title><h1>MdVisualizer Web</h1><p>アプリの配備を準備しています。</p></html>'; exit; }
readfile(__DIR__ . '/app.html');
