# GUI検証の分割・選択・時間計測

変更箇所に近い自動テストで修正を固めた後、影響するGUI工程だけを選ぶ。検証入口はビルド・インストール・公開を自動では追加しない。現在の選択規則は `scripts/gui-smoke/plan.mjs` を正本とし、計画と結果を同じ工程IDで記録する。

## 対象を決める

リポジトリルートから実行する。例の対象版は実際の版へ置き換える。Node.js 22以降とpwshを使う。

```powershell
# 計画だけ。ディレクトリー作成、CDP接続、ビルド、アプリ操作はしない
npm.cmd run debug:gui -- --version v0.0.19 --plan-only --changed src-tauri/src/sharepoint/navigation.rs
# 個別指定。前提の接続と文書準備を自動追加する
npm.cmd run debug:gui -- --version v0.0.19 --plan-only --scenario drawio
# PowerShellの入口からも同じ計画を確認できる
./scripts/run-debug-MdVisualizer-all-smoke.ps1 -TargetVersion v0.0.19 -ChangedPath src/styles/settings.css -PlanOnly
```

`--changed`はリポジトリ相対パスを繰り返して指定する。共有UIの正本パスとWindowsの区切りをDesktopの投影パスへ正規化する。変更パスと個別シナリオを同時指定して判定を上書きしない。共有Web固有の変更は各ホストの関連テストも別途選ぶ。

計画は選択理由と対象外の理由を残す。未登録の変更は `review-required` と終了コード2で止め、GUIを操作しない。変更内容をレビューして `--scenario` で選び直す。文書だけの変更はGUIを `not-required` とし、リンクと差分を検査する。これはGUI合格を意味しない。`src/App.tsx`、起動統合、依存などの横断変更は広く選ぶ。規則の登録は自動の網羅性証明ではないので、呼出し元・共有状態への波及もレビューする。

## WebViewの自動シナリオ

| ID | 内容 | 前提 |
|---|---|---|
| connect | 専用ローカルCDP接続とページの一意選択 | 専用プロセス、専用設定、専用ポート |
| document | 試験用タブを選び、ビジュアル・閲覧へ戻す | connect |
| view-context | 閲覧メニュー、選択、編集への移動 | document |
| structured-list | 入れ子リスト、階層、マーカー | document |
| mermaid | SVG待機、拡大、余白と背景 | document |
| drawio | SVG待機、拡大、余白 | document |
| diff | 表示、コード／分割切替、スクロール同期、終了 | document |

各機能は `scripts/gui-smoke/<ID>.mjs` へ分割した。接続は一度だけ、前提も重複実行しない。リストだけの試験でMermaidやdraw.ioの準備を待たない。専用文書の既定名は `v0.0.10-editing.md`。`--document-name`で名前を変える場合も各シナリオの期待値を満たすfixtureを使う。対象タブがなければ他のタブを操作せず失敗する。

```powershell
# 既に専用サンプルを開いた専用デバッグ版へ接続する。ビルド・起動・停止はしない
npm.cmd run debug:gui -- --version v0.0.19 --port 9333 --scenario drawio
# 複数ページの場合は対象IDを明示（不明なら操作を開始しない）
npm.cmd run debug:gui -- --version v0.0.19 --port 9333 --target-id <専用ページID> --scenario mermaid,diff
# PowerShellからも接続だけを選べる
./scripts/run-debug-MdVisualizer-all-smoke.ps1 -TargetVersion v0.0.19 -Scenario drawio -AttachOnly
```

CDPは同じlocalhostポートのみ許可する。同じ専用ページで複数のGUI検証を並行実行しない。利用者の通常プロセス、未保存文書、通常ブラウザーへ接続しない。検証後もアプリを保持する。DOM経由の操作と画面取得であり、実OSのキー入力・ファイルダイアログ・クリップボードの受入とは区別する。

従来のフル入口 `run-debug-MdVisualizer-all-smoke.ps1` は残す。`-AttachOnly`なしでWebView工程を選ぶと、従来のビルド・起動処理も実行するので日常の反復には使わない。引数なしは互換性のため従来5シナリオの一括実行。明示的な全WebView確認は `--scenario all`。ネイティブ観測はallに含めず、変更パスまたはIDで選ぶ。`-AllSamples`と部分選択の併用は拒否する。

`-AllSamples`の追加スイートは従来の `sample-suite-report.json` に記録する。追加スイートの時間と合否は今回の5シナリオのgui-summaryに含まれない。部分検証の結果を全サンプルの成功へ拡大しない。

## ネイティブ操作の個別計測

OSの操作は別工程として残す。実テナントの認証・ファイル取得を模擬通信やDOMの合格で代替しない。

| ID | 個別に確認するもの |
|---|---|
| native-prepare | 専用設定・文書・fixtureの準備 |
| native-startup | 専用プロセスの起動・状態API応答。必要なビルドもこの時間へ含める。既に起動中なら再起動せず由来と応答を確認 |
| native-target | 対象ウィンドウの一意選択・入力先確認・配置 |
| native-recording | 録画が必要な場合だけ個別指定し、準備と画面更新を確認。通常の変更判定では自動追加しない |
| received-url | 起動・再受信で原文、日時、経路、拒否理由が更新されること |
| url-copy | コピー操作後の実OSクリップボードと専用入力の一致。received-urlが前提 |
| open-shortcut | Ctrl+O、OSファイル選択、専用文書の実表示 |
| save-shortcut | Ctrl+S、保存完了、保存ファイルを開き直した内容 |
| shortcut-tooltips | 対応するボタンのツールチップと実キーの一致 |
| settings-errors | 実際のエラー状態で文字色と背景色を確認 |
| wiki-open | 実テナントの認証・権限・Markdown取得。必要な認証は利用者自身が行う |

```powershell
$run = Join-Path (Get-Location) ('dev/history/v0.0.19/logs/gui-native-' + [guid]::NewGuid().ToString('N'))
# 手動工程の台帳を作る。未実施なので終了コード2、合格ではない
npm.cmd run debug:gui -- --version v0.0.19 --output $run --scenario url-copy,open-shortcut
$summary = Join-Path $run 'gui-summary.json'
# 準備・操作それぞれの直前と直後に呼ぶ
node scripts/gui-smoke-manual.mjs $summary native-prepare start
# 専用プロセス等を確認し、同じ$run内へ観測証跡を保存する
node scripts/gui-smoke-manual.mjs $summary native-prepare finish --outcome passed --reason '専用入力先を確認した' --evidence preparation.json
# native-startup、native-targetもそれぞれ開始・観測・終了する
node scripts/gui-smoke-manual.mjs $summary received-url start
# 実画面を観測して同じフォルダーへ証跡を保存する
node scripts/gui-smoke-manual.mjs $summary received-url finish --outcome passed --reason '専用URLの受信更新を確認した' --evidence received.png
```

残りの工程も同様に開始・操作・観測・終了する。上の証跡ファイルは自動生成されない。観測せずに合格を記録しない。失敗は `--outcome failed --reason <観測した理由>` で残す。証跡は同じ実行フォルダー内の20MiB以下のファイルとし、ハッシュも保存する。実URL、秘密情報、利用者文書を報告へ自動収集しない。専用の無害な入力を使用する。

設定・文書準備と起動の目安はそれぞれ5分、入力先選択と録画準備はそれぞれ1分、各操作は2分。超過は `budgetExceeded` として記録する。時間超過だけで製品を不合格にせず、入力先や環境の問題なら状態を保って打ち切る。録画不良だけのために操作を繰り返さない。

## 結果と時間の読み方

出力は対象版の `dev/history/<版>/logs/<実行ID>/`。再実行は新しい実行IDを使い、同じ結果を上書きしない。

- `gui-summary.json`：対象選択と理由、工程の開始／終了、elapsedMs、結果、未実施、対象外、判定が必要な変更。
- `preview-report.json`：従来の表示測定値。部分実行では選んだ項目だけ。画像は各機能のファイル名で保存する。
- 自動工程は単調増加時計で計測する。`wallMs`は自動実行部分の全経過時間で、接続・準備・記録の時間も含む。
- 手動工程は開始・終了コマンド間の実時間で、観測者の待機も含む。時計が戻った場合は計測を拒否する。自動実行のwallMsへ合算しない。
- `passed`は選択された全工程が完了した場合だけ。対象外はexcluded、失敗後の後続と手動未観測はnot-run。対象外・未観測・要判断を成功件数へ含めない。
- 手動結果は `operator-observation`、模擬接続の自己試験はfixtureとして区別する。自己試験の成功は製品の実画面合格を意味しない。
- 終了コードは0=選択された工程の完了またはGUI不要、1=実行失敗、2=手動未完了または要判断。PowerShell入口は手動未完了を表示してアプリを保持するため、集計ではJSONのstatusとpassedを正とする。

自動の機能工程は30秒、CDPの各応答は25秒を上限とし、失敗後に別機能を実行しない。タイムアウト後もアプリを強制終了しない。実行中のWebView内Promiseは即時取消できるとは限らないので、状態を再確認してから次の実行へ進む。接続・入力先・録画の不調に長時間使わず、未確認境界として記録する。

## 拡張と再実行の判断

シナリオを追加するときはID、前提、変更パスの規則、選択理由、独立した検証関数と自己試験を併せて登録する。未知の変更を空の成功へ落とす規則を作らない。自動テストは[高速検証](/docs/developer/operations/02-development-automation.md)のrelatedまたは対象testファイルを使い、全回帰は修正を固めた最後にまとめる。その後の変更・失敗・未解決事項がある場合だけ必要な範囲を再実行する。

```powershell
npm.cmd run test:gui-smoke
```

自己試験は分岐、依存順、計測、失敗保存、打切り、手動証跡、CLI、模擬CDPと各機能の判定を検証する。PowerShellのPlanOnlyも実行するが、製品のGUI・実認証・録画・OS入力は操作しない。検証基盤だけの変更で製品の全回帰・フルビルドを形式的に再実行しない。
