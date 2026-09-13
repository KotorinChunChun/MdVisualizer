# MdVisualizer Web版 PHP運用

この資料は、`web/php/` のPHPバックエンドと `web/php-config.example.json` を正本にした運用基準です。対象は、ブラウザーで暗号化したZIPを一時保管するWeb版です。

## さくらライトの配置

本番基準は、さくらのレンタルサーバー ライト、FreeBSD、PHP 8.2系です。既存環境の基準値はPHP 8.2.32、Web公開ルートは `/home/excel-chunchun/www/` です。

設定ファイルは公開領域の外へ置きます。`web/php-config.example.json` を元に、次の場所へ配置します。

```text
/home/excel-chunchun/private/mdvisualizer.json
/home/excel-chunchun/private/mdvisualizer-storage/
```

設定ファイルの例は次のとおりです。`client_secret` は実値を設定しますが、Git、公開ファイル、ログへ記録しません。

```json
{
  "callback_url": "https://excel-chunchun.sakura.ne.jp/test/mdvisualizer/api.php?action=callback",
  "storage_dir": "/home/excel-chunchun/private/mdvisualizer-storage",
  "max_items_per_user": 20,
  "max_bytes_per_user": 104857600,
  "max_bytes_total": 1073741824,
  "providers": {
    "google": {"client_id": "", "client_secret": ""},
    "microsoft": {"client_id": "", "client_secret": ""}
  }
}
```

設定ファイルと保管フォルダーは、Web公開ルートの配下に置きません。保管フォルダーはPHPが作成する場合も`0700`を基準とし、既存フォルダーの所有者・書き込み権限を確認します。`web/php/.htaccess` でもJSON、ZIP、作業用`.part`の直接取得を拒否しますが、公開領域外配置が基本です。

`MDVISUALIZER_CONFIG`環境変数をPHP実行環境へ設定すると、その絶対パスを設定ファイルとして使用します。未設定時はドキュメントルートの親にある`private/mdvisualizer.json`を参照します。秘密情報をURLパラメーターやHTMLへ渡しません。

必要なPHP拡張は`openssl`、`curl`、`mbstring`です。`openssl`はOIDCのRSA署名検証、`curl`はGoogle/Microsoftのトークン・JWKS取得、`mbstring`は表示名の長さ制限に使います。サーバー側でZIPを復号しないため、サーバーのPHP `zip`拡張は暗号化データの検査には必須ではありません。

## Google / MicrosoftのSSO登録

両プロバイダーとも、認可コード、PKCE（S256）、nonce、stateを使うWebアプリとして登録します。登録するredirect URIは設定ファイルの値と完全一致させます。

```text
https://excel-chunchun.sakura.ne.jp/test/mdvisualizer/api.php?action=callback
```

Google Cloud側ではOAuthクライアントをWebアプリケーションとして作成し、上記URLを承認済みのリダイレクトURIへ追加します。クライアントシークレットは`mdvisualizer.json`だけへ保存します。

Microsoft Entra ID側ではWebプラットフォームのリダイレクトURIへ上記URLを追加します。個人Microsoftアカウントと任意の組織アカウントを受け入れる登録を使用し、クライアントシークレットはサーバーだけへ配置します。現行コードはMicrosoftの認可・トークン・JWKSエンドポイントを`login.microsoftonline.com`へ固定し、IDトークンの`tid`とissuerを検証します。

SSO成功後にサーバーが保持するのは、プロバイダー、OIDC subjectから導出した所有者ID、表示名、セッション期限です。Google/Microsoftのアクセストークン、リフレッシュトークン、IDトークンは保存しません。アプリパスワード、利用者パスワード、パスワードハッシュも使いません。

この認証は、既存の`excel-chunchun/www/auth`にあるGoogle共通認証とは独立しています。既存認証の`pending` / `active`承認状態は参照せず、MdVisualizer Web版自身のOIDCセッションで利用者を識別します。共通サイトの認証ファイルやユーザー承認データを変更しません。

## 暗号化ZIPと保管期限

ZIPはブラウザー側の`@zip.js/zip.js`でAES-256暗号化してから、利用者が明示的に保存操作を実行したときだけ送信します。サーバーが受け取るのは暗号化済みZIPだけで、復号鍵、パスワード、平文ZIPは送信しません。PHPはZIPの外形、AES方式、パス、サイズ、構造だけを検査します。

既定の制限は次のとおりです。

- 1回のアップロード: 32 MiB
- ZIP内エントリ数: 1,000件以下
- 展開後に申告された合計容量: 128 MiB以下
- 1ユーザーあたり: 20件、100 MiB以下
- 全ユーザー合計: 1 GiB以下
- 保管期限: 作成から10日

期限はクライアント時刻ではなくサーバー時刻で判定します。期限切れデータは、一覧、ダウンロード、保存、削除など保管領域へアクセスしたリクエストのロック中に削除します。定期cronがなくても、次回アクセス時にJSONメタデータとZIP本体を一緒に削除します。期限切れの項目をダウンロードできる猶予はありません。

ファイル名はサーバーで生成したランダムIDを使い、利用者入力のパスを保存名にしません。アップロードは`.part`へ書いてからZIPへrenameし、失敗時には作業ファイルを削除します。利用者ごとに所有者ディレクトリを分け、一覧・取得・削除のたびにセッションの所有者と一致することを確認します。

## HTTPS、セッション、CSRF

本番はHTTPSのみを前提にします。セッションCookieは`HttpOnly`、`Secure`、`SameSite=Lax`で、ログイン成功時にセッションIDを再生成します。保存・削除はPOSTとCSRFヘッダーを要求します。API応答は`no-store`、`nosniff`を設定し、暗号化ZIPをブラウザーキャッシュへ残さないようにします。

## ローカル検証

Windowsのリポジトリでは、同梱PHP 8.2.33を使って次を実行します。PHP拡張はコマンドラインで明示します。

```powershell
node web/tests/php-zip-fixtures.mjs dev/history/v0.0.18/logs/php-security/fixtures
.\.tools\php82\php.exe `
  -d extension_dir=.tools/php82/ext `
  -d extension=openssl `
  -d extension=curl `
  -d extension=mbstring `
  web/tests/php-security.php dev/history/v0.0.18/logs/php-security/fixtures
node web/tests/php-http-integration.mjs
```

`php-security.php`はRSA/JWK署名検証、nonce/audience/期限、所有者分離、CSRF、暗号化ZIP検査、期限清掃を確認します。`php-http-integration.mjs`はPHP組み込みHTTPサーバーへ接続し、未認証拒否、アップロード、ダウンロード、別所有者拒否、期限切れ清掃、quota、削除を実測します。テストの一時設定・セッション・サーバーログは対象版の`dev/history/v0.0.18/logs/<実行識別子>/`へ出力します。

この手順はローカル実装検証です。実際のGoogle/Microsoftアプリ登録、秘密情報の投入、さくらサーバーへのアップロード、redirect URIの到達確認、実SSOログインは別工程であり、今回の検証には含めていません。
