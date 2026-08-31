# MarkdownViewer テストケース設計

作成日: 2026-08-30
状態: PROPOSED

各機能群について正常、異常、境界、性能、セキュリティを最低1件ずつ定義する。詳細な入力データはseed付きfixture generatorで生成する。

## 1. 文書I/O・文字コード・保存

| テストID | 観点 | 前提条件 | 手順 | 期待結果 |
| --- | --- | --- | --- | --- |
| DOC-N-001 | 正常 | UTF-8/LF文書 | 開く→編集→保存→再読込 | 内容・encoding・改行・revisionが一致 |
| DOC-E-001 | 異常 | 読取専用文書 | 保存する | 元ファイル不変、権限エラー、draft保持 |
| DOC-B-001 | 境界 | 空、BOMのみ、UTF-16、Shift_JIS、混在改行 | 各文書を往復保存 | 自動文字化け・末尾改行変更がない |
| DOC-P-001 | 性能 | 10,000行文書 | releaseで10回読込 | 初回表示p95 1秒以下、UI停止なし |
| DOC-S-001 | security | `../`参照、symlink、巨大ファイル | asset読込・保存を試行 | 許可範囲外拒否、部分書込みなし |

## 2. タブ・ウィンドウ・設定・セッション

| テストID | 観点 | 前提条件 | 手順 | 期待結果 |
| --- | --- | --- | --- | --- |
| SES-N-001 | 正常 | 3文書 | 開く、並替、切替、閉じたタブ復元 | active/順序/scrollが一致 |
| SES-E-001 | 異常 | 欠落ファイルを含むsession | session候補を開く | 他タブは開き欠落だけ通知 |
| SES-B-001 | 境界 | 0/1/100タブ | 保存・復元 | 重複せず100タブを100ms目標で保存 |
| SES-P-001 | 性能 | 10文書各10,000行 | タブを連続切替 | p95 100ms以下、非active DOMを保持しない |
| SES-S-001 | security | session DBを改変 | 起動 | path/JSON検証、実行可能値を解釈しない |

## 3. Markdown編集・Diff

ローカルMarkdownのDiffについては、実装済みの[変更パターンと検証](04-document-diff.md)に自動検証と別環境の受入を分けて記録する。

| テストID | 観点 | 前提条件 | 手順 | 期待結果 |
| --- | --- | --- | --- | --- |
| EDT-N-001 | 正常 | ATX見出し・list・table | toolbar/key操作、Undo/Redo、保存 | 対象構文だけ変更、1操作単位でUndo |
| EDT-E-001 | 異常 | 外部更新済み | 編集後保存 | 自動上書きせずDiffへ遷移、draft保持 |
| EDT-B-001 | 境界 | 空選択、絵文字、NUL、RTL、1万文字選択 | 挿入/切取/貼付 | surrogate破壊なし、仕様どおり保持 |
| EDT-P-001 | 性能 | 10,000行 | 連続100入力 | long task 50ms未満、preview debounce安定 |
| EDT-S-001 | security | HTML/script文字列を貼付 | preview表示 | script非実行、sourceは意図せず改変しない |

## 4. 検索・目次・診断・履歴

| テストID | 観点 | 前提条件 | 手順 | 期待結果 |
| --- | --- | --- | --- | --- |
| NAV-N-001 | 正常 | 折畳・重複文字・プレゼン | 検索結果から移動、戻る/進む | ancestor展開、正確なsource、履歴復元 |
| NAV-E-001 | 異常 | 不正regex・欠落参照 | 検索/診断 | 理由表示、他診断継続、UI操作可能 |
| NAV-B-001 | 境界 | 0/500/501件、H1〜H6境界 | 検索・目次移動 | 上限表示、境界行を誤選択しない |
| NAV-P-001 | 性能 | 10,000行/1,000見出し | 検索を10回実行 | p95 200ms以下、古い世代を破棄 |
| NAV-S-001 | security | URL encode/traversal/HTML image | 診断 | 文書を書換えず許可範囲だけ検査 |

## 5. Markdown/HTML/コード表示・外部操作

| テストID | 観点 | 前提条件 | 手順 | 期待結果 |
| --- | --- | --- | --- | --- |
| RND-N-001 | 正常 | CommonMark/GFM/HTML/code | light/dark表示、コピー | 記法、言語名、file名が正しい |
| RND-E-001 | 異常 | 未知言語、壊れHTML | 表示 | plain code/fallbackで文書全体は表示 |
| RND-B-001 | 境界 | 深いlist/quote、長い行、巨大code | 表示・copy | stack overflow/切詰め誤りなし |
| RND-P-001 | 性能 | 100 code block | scroll/切替 | highlight遅延、操作を妨げない |
| RND-S-001 | security | script/event/javascript URL | 表示・link操作 | CSP/サニタイズで実行・危険遷移なし |

## 6. PowerShell・外部アプリ

| テストID | 観点 | 前提条件 | 手順 | 期待結果 |
| --- | --- | --- | --- | --- |
| PRC-N-001 | 正常 | 明示`pwsh` fence | 内容/作業dir確認後実行 | shell非介在、結果とexit code表示 |
| PRC-E-001 | 異常 | CLIなし/exit非0 | 実行 | 文書不変、stderr安全化、再設定導線 |
| PRC-B-001 | 境界 | 256KiB入力/1MiB出力/30秒 | 上限前後で実行 | 上限超過停止、子process残留なし |
| PRC-P-001 | 性能 | 出力を継続生成 | 実行中に編集 | UI応答維持、streamをbounded処理 |
| PRC-S-001 | security | shell metachar/path traversal | 外部アプリ/PowerShell実行 | 引数配列扱い、作業dir逸脱なし |

## 7. 表・CSV・TSV

| テストID | 観点 | 前提条件 | 手順 | 期待結果 |
| --- | --- | --- | --- | --- |
| TBL-N-001 | 正常 | GFM/CSV/TSV | edit、sort、filter、aggregate、copy、print | 共通modelで結果一致 |
| TBL-E-001 | 異常 | malformed quote/列数不一致 | 表示・編集 | エラー位置表示、元source不変 |
| TBL-B-001 | 境界 | 0/1/1,000行、セル内tab/newline | paste/copy/Undo | 引用保持、1回でUndo、末尾編集保持 |
| TBL-P-001 | 性能 | 1,000×20 | sort/filter/edit | p95 150ms目標、toolbar操作可能 |
| TBL-S-001 | security | formula prefix/HTML cell | CSV copy/export/preview | 数式注入を警告/安全化、HTML非実行 |

## 8. Mermaid・draw.io・PlantUML・SVG

| テストID | 観点 | 前提条件 | 手順 | 期待結果 |
| --- | --- | --- | --- | --- |
| DIA-N-001 | 正常 | 各図表fixture | render、zoom、copy、edit、保存 | source/alt/形式を保持 |
| DIA-E-001 | 異常 | 構文error/network失敗/競合 | 表示・編集 | fallback、modal維持、文書不変 |
| DIA-B-001 | 境界 | 空図、負座標、巨大図、4外部表現 | 往復変換 | viewBox/余白/alt/拡張子を保持 |
| DIA-P-001 | 性能 | 50図、画面外配置 | scroll | visible図だけ遅延render、UI停止なし |
| DIA-S-001 | security | SVG script/foreignObject/外部href、偽postMessage | 表示・編集 | 除去、origin/source不一致拒否 |

## 9. 画像編集・アセット

| テストID | 観点 | 前提条件 | 手順 | 期待結果 |
| --- | --- | --- | --- | --- |
| IMG-N-001 | 正常 | raster/SVG/Base64/SharePoint | crop/annotate/convert/save/restore | 対象出現だけ更新、backup/revision保持 |
| IMG-E-001 | 異常 | 読取専用/外部変更/disk full | 保存 | 元画像不変、編集状態保持 |
| IMG-B-001 | 境界 | 1px/巨大/透明/EXIFなし | rotate/crop/padding | 座標、色、寸法が範囲内 |
| IMG-P-001 | 性能 | 大画像・20画像gallery | preview/edit | memory上限、object URL解放 |
| IMG-S-001 | security | polyglot/偽MIME/traversal SVG | 読込 | 実形式検査、範囲外/危険要素拒否 |

## 10. 印刷・PDF・プレゼン

| テストID | 観点 | 前提条件 | 手順 | 期待結果 |
| --- | --- | --- | --- | --- |
| PRT-N-001 | 正常 | 通常/プレゼン/表 | Print to PDF | UIなし、light、設定metadata、ページ構造一致 |
| PRT-E-001 | 異常 | Mermaid error/timeout/取消 | 印刷 | 続行/中止規則どおり、画面状態を復元 |
| PRT-B-001 | 境界 | 空/長表/長code/巨大画像 | 印刷 | 切断規則が一貫、overflowで内容消失なし |
| PRT-P-001 | 性能 | 100ページ相当 | 印刷準備 | timeout表示、main UIを無期限blockしない |
| PRT-S-001 | security | 外部画像/HTML form | 印刷 | 追加通信・script・機密UI出力なし |

## 11. SharePoint・SPFx・モバイル

| テストID | 観点 | 前提条件 | 手順 | 期待結果 |
| --- | --- | --- | --- | --- |
| SP-N-001 | 正常 | 権限あり、PNG/SVG参照 | load/edit/save | encoding/eTag保持、同一libraryだけ処理 |
| SP-E-001 | 異常 | 401/403/404/412/429 | load/save | 共通error code、元文書不変、適切な再試行 |
| SP-B-001 | 境界 | 10MB前後、Unicode path、複数library | load | 上限、encode、library選択が正しい |
| SP-P-001 | 性能 | 高遅延、50文書候補 | browse/edit | progressive表示、入力をblockしない |
| SP-S-001 | security | 別tenant redirect/token誘導 | asset/save | Authorization非送信、URI拒否 |

## 12. SPFxレスポンシブUI

| テストID | 観点 | 前提条件 | 手順 | 期待結果 |
| --- | --- | --- | --- | --- |
| MOB-N-001 | 正常 | 390px touch | 閲覧、検索、簡易編集、保存 | 主要操作が44px targetで完結 |
| MOB-E-001 | 異常 | offline/保存競合 | 編集・保存 | draft保持、状態と解決導線表示 |
| MOB-B-001 | 境界 | 320/390/768px、200% text | 全画面巡回 | 重なり・横page overflowなし |
| MOB-P-001 | 性能 | 低速端末想定 | scroll/input | long task抑制、図表遅延load |
| MOB-S-001 | security | shared device/browser back | sign-out/戻る | secret/本文をbrowser storageへ残さない |

## 13. SQLite補助DB・Provider

| テストID | 観点 | 前提条件 | 手順 | 期待結果 |
| --- | --- | --- | --- | --- |
| DBP-N-001 | 正常 | 旧JSONあり | 初回起動、provider解決 | migration成功、同じ設定、正しいprovider |
| DBP-E-001 | 異常 | DB破損/migration失敗/provider未構成 | 起動 | 隔離/fallback/設定導線、文書利用可能 |
| DBP-B-001 | 境界 | schema 0/将来版、0/100タブ | migration/session | 冪等、将来schema非破壊、性能基準内 |
| DBP-P-001 | 性能 | 並行10更新 | settings/session保存 | timeout内、別key更新を失わない |
| DBP-S-001 | security | DB走査 | 設定・session保存後確認 | 本文、key、token、promptが存在しない |

## 14. SharePointバックグラウンド同期

| テストID | 観点 | 前提条件 | 手順 | 期待結果 |
| --- | --- | --- | --- | --- |
| SYN-N-001 | 正常 | clean local、remote更新 | scheduler実行 | pullして表示更新、UI状態保持 |
| SYN-E-001 | 異常 | offline→online、429、401 | job実行 | backoff/Retry-After/再認証、job消失なし |
| SYN-B-001 | 境界 | 0/1/100対象、同時変更 | 一括check | bounded並列、412は全てconflict |
| SYN-P-001 | 性能 | 100対象 | 5分周期を模擬 | UI main thread 50ms以上占有なし |
| SYN-S-001 | security | 別host redirect、DB改変 | sync | token非送信、対象外URI拒否、自動削除なし |

## 15. AI API・CLI・提案Diff

| テストID | 観点 | 前提条件 | 手順 | 期待結果 |
| --- | --- | --- | --- | --- |
| AI-N-001 | 正常 | fake API/CLI構成済み | 8機能を実行→Diff採用 | 共通schema、draftだけ更新、保存は別操作 |
| AI-E-001 | 異常 | key不正/CLI未login/timeout/invalid JSON | 実行 | 原文不変、再設定、子process/一時dir残留なし |
| AI-B-001 | 境界 | 空選択、context超過、100文書、巨大出力 | 実行 | 対象縮小を確認、上限超過を安全停止 |
| AI-P-001 | 性能 | 長stream | 実行中に編集・取消 | UI応答、cancel後event無視、memory bounded |
| AI-S-001 | security | prompt/shell/path/symlink injection | CLI/API編集案 | scope拡大なし、元file非変更、secret非露出 |

## 16. 配布・更新・OSS

| テストID | 観点 | 前提条件 | 手順 | 期待結果 |
| --- | --- | --- | --- | --- |
| OPS-N-001 | 正常 | release承認済み | MSIX/SPFx/ZIP build・stage・publish | 版、署名、hash、公開物が一致 |
| OPS-E-001 | 異常 | 署名不一致/upload失敗 | release実行 | 公開停止、stable非変更、再開可能 |
| OPS-B-001 | 境界 | beta/stable、同版/新版 | plan検証 | channel誤配布・downgradeを拒否 |
| OPS-P-001 | 性能 | 全成果物 | build/download | サイズと時間を記録し異常増加を通知 |
| OPS-S-001 | security | secret scan/第三者license/audit | 公開前検査 | secret 0、High以上0または期限付き例外、MIT表記あり |

## 17. 手動確認として残す項目

- Microsoft Print to PDFの最終ページ見た目とOSダイアログ。
- 実diagrams.netの描画品質と外部サービス側UI変更。
- Windows資格情報マネージャー、既定アプリ、VS Code、MSIX更新の実OS統合。
- 色覚・読みやすさの人間評価。

これらも手順、期待結果、スクリーンショットまたは生成PDF、実施日、実施者、アプリ版を記録し、「目視で問題なし」だけで完了させない。
