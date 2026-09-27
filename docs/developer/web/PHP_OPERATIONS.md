# MdVisualizer Web版 PHP運用

この資料は、canonicalである `web-platform/apps/web/php/` のPHPバックエンドと `web-platform/apps/web/php/php-config.example.json` を正本にした運用基準です。親リポジトリの旧 `web/php/` は互換リンクです。対象は、ブラウザーで暗号化したZIPを一時保管するWeb版です。

`index.php`はSSOセッションを確認し、未認証ならサインイン画面を返します。認証済みの場合だけ生成済み`app.html`を読み出します。Apacheの`.htaccess`は`app.html`への直接アクセスを拒否するため、設置時はこのファイルも必ず配置してください。PHPの開発サーバーは`.htaccess`を解釈しません。ローカル検証用であり、そのまま公開する構成ではありません。

## さくらライトの配置

本番基準は、さくらのレンタルサーバー ライト、FreeBSD、PHP 8.2系です。既存環境の基準値はPHP 8.2.32、Web公開ルートは `/home/excel-chunchun/www/` です。

設定ファイルは公開領域の外へ置きます。`web-platform/apps/web/php/php-config.example.json` を元に、次の場所へ配置します。

```text
/home/excel-chunchun/private/mdvisualizer.json
/home/excel-chunchun/private/mdvisualizer-storage/
```

設定ファイルの例は `php-config.example.json` にあるstorage設定だけを使用します。認証プロバイダーやclient secretをこの設定へ追加しません。

```json
{
  "storage_dir": "/home/excel-chunchun/private/mdvisualizer-storage",
  "max_items_per_user": 20,
  "max_bytes_per_user": 104857600,
  "max_bytes_total": 1073741824
}
```

設定ファイルと保管フォルダーは、Web公開ルートの配下に置きません。保管フォルダーはPHPが作成する場合も`0700`を基準とし、既存フォルダーの所有者・書き込み権限を確認します。`web-platform/apps/web/php/.htaccess` でもJSON、ZIP、作業用`.part`の直接取得を拒否しますが、公開領域外配置が基本です。

`MDVISUALIZER_CONFIG`環境変数をPHP実行環境へ設定すると、その絶対パスを設定ファイルとして使用します。未設定時はドキュメントルートの親にある`private/mdvisualizer.json`を参照します。秘密情報をURLパラメーターやHTMLへ渡しません。

必要なPHP拡張は`openssl`、`curl`、`mbstring`です。認証処理はサイト共通 `auth/bootstrap.php` の要件に従い、`mbstring`は表示名の長さ制限に使います。サーバー側でZIPを復号しないため、サーバーのPHP `zip`拡張は暗号化データの検査には必須ではありません。

アプリとともに`.user.ini`を配置します。32 MiBのZIPを受信するため、`post_max_size=40M`、`upload_max_filesize=32M`、`memory_limit=128M`、`max_execution_time=60`を指定し、HTTP応答へのPHP内部エラー表示を無効にします。設置先のPHP設定がこのファイルを許可・反映することを公開時に確認してください。反映されない場合は、サーバーの管理画面で同じ値を設定します。アプリ内部のZIP上限は32 MiBのままです。

## サイト共通SSO

SSOはサイト共通の `auth/bootstrap.php` を再利用します。Google/MicrosoftのOAuth登録、redirect URI、秘密情報、セッション開始はサイト共通側の運用に従い、MdVisualizer独自のOIDC登録や独立sessionを作りません。

```text
https://excel-chunchun.sakura.ne.jp/test/mdvisualizer/api.php?action=callback
```

Google Cloud側ではOAuthクライアントをWebアプリケーションとして作成し、上記URLを承認済みのリダイレクトURIへ追加します。クライアントシークレットは`mdvisualizer.json`だけへ保存します。

Microsoft Entra ID側ではWebプラットフォームのリダイレクトURIへ上記URLを追加します。個人Microsoftアカウントと任意の組織アカウントを受け入れる登録を使用し、クライアントシークレットはサーバーだけへ配置します。現行コードはMicrosoftの認可・トークン・JWKSエンドポイントを`login.microsoftonline.com`へ固定し、IDトークンの`tid`とissuerを検証します。

SSO成功後は共通認証が管理する利用者IDとセッションを利用します。MdVisualizerはOAuthトークンやパスワードを独自に保存しません。

共通認証のユーザー状態は`pending` / `active`を受け入れ、それ以外の状態は拒否します。ログアウトはサイト全体のlogout処理を使用します。旧OIDC実装と独自セッション経路は未使用です。

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

本番はHTTPSのみを前提にします。セッションCookieは共通認証の設定に従います。保存・削除はPOSTと専用CSRFトークンを要求します。API応答は`no-store`、`nosniff`を設定し、暗号化ZIPをブラウザーキャッシュへ残さないようにします。

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
node web/tests/site-auth-http-integration.mjs
```

`php-security.php`は所有者分離、専用CSRF、暗号化ZIP検査、期限清掃を確認します。`php-http-integration.mjs`はPHP組み込みHTTPサーバーへ接続し、未認証拒否、アップロード、ダウンロード、別所有者拒否、期限切れ清掃、quota、削除を実測します。`site-auth-http-integration.mjs` と `site-auth.php` は共通サイト認証のpending/active受容、その他の状態の拒否、サイト全体logoutを確認します。テストの一時設定・セッション・サーバーログは対象版の`dev/history/v0.0.18/logs/<実行識別子>/`へ出力します。

`node web/tests/php-browser-integration.mjs`は、テスト専用セッションを使って実ブラウザーからZIPを開き、明示保管・復号取得と本文／画像復元を確認します。実Google/Microsoftログインの代用とはしません。共通認証の確認には `node web/tests/site-auth-http-integration.mjs` を実行し、`pending` / `active` の受容、その他の状態の拒否、サイト全体logoutを確認します。

この手順はローカル実装検証です。サイト共通SSOの実設定、秘密情報の投入、さくらサーバーへのアップロード、実SSOログインは別工程であり、今回の検証には含めていません。
