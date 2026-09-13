# dev・docsの整理計画と配置ルール整備

> この初回案は後続のユーザー指示で置き換え済み。現在の方針と実施状況は[移行記録](implementation.md)を参照。以下は当時の案として保持する。

作成日: 2026-09-13

対象: MdVisualizerの開発資料、公開資料、配置を決める共通・プロジェクトルール

状態: 配置調査・移動案作成、ルールと目録を整備。既存ファイルの移動・改名・本文統合は未実施。

正本: 本書は今回の調査・整理計画・実施記録。[AGENTS.md](../../../AGENTS.md)は恒久的な配置規則。
終了条件: 移動を実施する際に各候補の参照・生成元を更新し、未解決項目の行先と検証結果を本書へ記録する。

## 1. 結論と調査範囲

混乱の主因は、フォルダーが多いことそのものではなく、現行仕様・提案・作業履歴・提供原本・生成物が同じ場所や同じ文書に混ざり、正本と移行の完了条件が曖昧になったことである。次の順で整理する。

1. 配置規則と目録を一本化し、現行資料の案内と実行条件の矛盾を直す（今回実施）。
2. 旧版資料、長期計画、提供原本の移動対応表を確定し、参照を一緒に移す。
3. 提案と現行契約が混在する文書を節単位で分離し、現在使える説明をdocsへ集約する。
4. 生成HTML・画像・ZIPは生成元から出力先を変更する。原本・再生成手順は保持する。

調査開始時のmainは`d421221`、作業ツリーはクリーン。通常の`rg --files`列挙ではdev 544件、docs 19件、dev直下42件だった。Git除外・隠しファイルを含むディスク全体の件数ではない。dev直下の除外済みログも名前とサイズだけ確認した。

グローバルAGENTS、共通PROJECT_RULE、プロジェクトAGENTS、目録、版別資料の状態、関係するソース・生成スクリプト、Git履歴を調査した。大容量生成物・vendor全体の内容監査や、旧版の全受入項目の再判定はしていない。`dev/private/`と`dev/temp/`の内容は調査対象外。製品コード、要求原文、版番号、配布物は変更していない。

## 2. 適用したルールと不足

| ルールの所在 | 既存の規則 | 今回確認した不足・対応 |
|---|---|---|
| `C:/Users/amekoro/.codex/AGENTS.md` | 明確な指示前に変更しない。版別req/imp/task、次版移行時のhistory移動 | 配置前確認がなく、共通ガイドを読む条件が「概要が分からないとき」に限られていた。配置判断は概要を知っていても行う規則を追記 |
| `C:/develop/default/dev/templates/PROJECT_RULE.md` | docsは利用者・開発者向け説明、devは内部計画。samplesは追跡、生成物は除外 | 提案と現行契約、試作と提供原本、調査と生成出力の判定を補足。`reject.md`と`PLAN_REJECT.md`の名前の不一致も後者へ統一 |
| [プロジェクトAGENTS](../../../AGENTS.md) | 読者別の配置、scriptsの例外、private/temp保護 | `roadmap/`または直下roadmapという二択、目録の所在、生成物や研究資料の置き方が曖昧。分類と移行完了条件を追記 |
| プロジェクトの3つのskill | AGENTSとreq/imp/taskを着手前に読む | この入口は既にある。配置規則をskillごとに複製せず、AGENTS側を強化 |
| 現在の`major-app-update-planning/SKILL.md` | プロジェクト規則優先。`docs/roadmap/`や`docs/tasks/`を独自に増やさない | 現在の禁止規則は確認できる。ただし作成当時のskill内容や実際の適用有無は未確認。現在のskillを過去の配置の直接原因とは断定しない |

## 3. なぜこの配置になったか

AIの内心や、すべてのファイルの作成者をGitだけから特定することはできない。以下は記録で確認できる経緯と、それに基づく運用上の原因である。

| 確認できた事実・根拠 | 配置を生んだ理由と再発経路 | 対策 |
|---|---|---|
| `d521667`で`docs/roadmap/`、`docs/tasks/`、設計・UI・検証・品質資料を一括作成 | 大きな計画を成果物の種類別に展開し、内部計画もdocsに置いた | 出力例をそのままフォルダー化せず、既存正本と読者・状態を先に確認 |
| `3487d90`でroadmap群をdev直下へ移し、docsの索引を削除。[当時の索引](../../history/v0.0.14/v0.0.14-roadmap-index.md)にも「既存規約に合わせてdev直下」と明記 | 一度是正された直下配置が前例になった。提案設計やUI案はdocs側に残った | 長期計画の置き場を`dev/roadmap/<対象>/`へ統一。既存例外を新設の根拠にしない |
| [設計目録](/docs/DEVELOPERS_GUIDE.md#設計資料一覧)はDES-01〜04がPROPOSED、05〜06がDEFERRED | 「公開可能な設計」でdocsへ分類したため、採用・実装状態の区別が弱くなった | 公開可否と、現行契約として使える状態かを別々に判定 |
| [UI案](/docs/developer/ui/01-product-ux.md)はPROPOSEDだが末尾にv0.0.17の現行挙動。[テスト計画](/docs/developer/testing/01-test-strategy.md)も提案と現行入口が混在 | 既存文書への追記で小さく修正した結果、文書全体の状態を更新できなくなった | 節ごとに現行・提案・履歴を分け、正本は一つにする |
| `4814b80`ではv0.0.17をhistoryへ移したが、dev目録は今回修正前までv0.0.16を現行と案内 | 版別の移動対象だけを閉じ、目録や古い並行資料の整合確認が漏れた | 版移行・ブランチ統合後に目録と残存資料を確認 |
| [生成スクリプト](../../../scripts/generate-editing-test-report.mjs)の6行目は`dev/history/v0.0.11/logs/legacy-editing/editing-test-cases-report.html`を固定出力。導入は`7a68e5e` | AIがファイルだけを移しても、npmの`report:editing`でdev直下へ戻る | 出力先・生成元・参照元を同時に変更 |
| `d0ff924`で公開前監査をimpから独立。[監査](../../history/v0.0.15/v0.0.15-imp-リリース前点検報告.md)とimp/task/目録が参照 | この独立化はユーザーの明示依頼に沿うもので、誤配置の原因とは限らない | 別文書の正本を維持し、impへ再統合しない。整理するのは保管場所と索引 |
| [Mermaid試作報告](../20260913_mermaid-editor/mermaid-editor-imp.md)は版未指定の独立試作を`dev/research/mermaid-editor`へ作成したと記録 | 試作を製品本体から分ける意図は妥当。提供資料と試作コード・報告が別階層に散在し、昇格時の整理条件がない | 試作は保持し、本体へ統合するときの原本・コード・検証・生成物の移行条件を定める |
| GUI禁止はAGENTSで解除済みだが、開発者ガイドとビルド手順に禁止が残っていた | 実行可否を複数文書へコピーし、一方だけ更新した | 可否の本文はAGENTSへ集約し、手順から参照（今回修正） |

## 4. 整理後の構成案

以下は目標構成であり、未作成の移動先を含む。空のフォルダーやひな型一式を先に増やさず、対象を移す段階で作成する。

```text
dev/
  README.md                         # 現行・予定版、目的別資料の入口
  RELEASE_RULE.md / PLAN_IDEAS.md / PLAN_REJECT.md
  v0.0.18-{req,imp,task}.md
  v0.0.18-html-export-design.md      # 版別の補助設計。進捗正本はtask
  history/vX.Y.Z/                   # 完了版とその判断・証跡
  roadmap/v0.0.14-baseline/          # 当時の長期計画、提案設計、提案UI・品質
  maintenance/                      # 版に属さない運用整理・監査
  research/<対象>/                  # 試作、提供原本、req/imp、試作用サンプル
  design/<対象>/                    # 制作原本と再生成手順
  scripts/                          # 開発記録に密接な補助
docs/
  README.md / DEVELOPERS_GUIDE.md / BUILD_COMMANDS.md
  HTML_EXPORT_CLI.md                # 既存の利用者向け入口名を保持
  design/html-export.md             # 現在確定したCLI契約・API
  ui/                              # 現行操作・状態
  testing/                         # 現在実行できる検証手順
  operations/                      # 実際に運用する品質手順
samples/                           # 正本が追跡される回帰サンプル
tmp/verification/<対象>/<実行>/     # 一時出力。Git除外
release/                           # 配布ZIP等。Git除外
```

## 5. devの移動・改名・統合候補

この表の操作は未実施。`{req,imp,task}`等は対象が明確な一式を示す。原本の重複・残件・依存関係を確認し、下記条件を満たしてから移す。

| 現在の対象 | 推奨先・操作 | 理由・移行条件 |
|---|---|---|
| `v0.0.10-req.md`、`v0.0.10-imp.md`、`0.0.10-task.md` | `history/v0.0.10/`。taskだけ`v0.0.10-task.md`へ改名 | 直下に旧版3点が残存。後続の完了根拠と残件を照合し、参照も更新 |
| `v0.0.12-{req,imp,task}.md` | `history/v0.0.12/` | 同上。未チェックだけで現行の残件へ戻さない |
| `v0.0.13-{req,imp,task}.md` | `history/v0.0.13/` | 同上。受入の経過と最終判定を保持 |
| `v0.0.14-{req,imp,task}.md` | `history/v0.0.14/` | 実施報告と長期提案を区別。長期案は次行のroadmapへ |
| `v0.0.15-{req,imp,task}.md` | `history/v0.0.15/` | 最終報告の未確認事項と後続v0.0.17の受入・保留先を照合 |
| `v0.0.16-{req,imp,task}.md` | `history/v0.0.16/` | taskは全完了、impには過去時点のGUI未実施等もある。公開済み範囲と未検証範囲を維持 |
| `v0.0.11-editing-test-questions.md` | `history/v0.0.11/`へ同名移動 | v0.0.11のreq/imp/taskは既にhistory。質問・暫定結果が直下に取り残されている |
| `v0.0.14-roadmap.md`と`v0.0.14-roadmap-{index,current-state,decisions,next-release,risks,tasks}.md`の7点 | `roadmap/v0.0.14-baseline/`へ同名移動 | 基準版を保って一式をまとめる。新しい計画に見せる改版はしない。tasksを現行taskと二重管理しない |
| `v0.0.18-{req,imp,task}.md` | 直下を維持 | 現在進行中の版別正本。CLI完成と本体統合予定を区別 |
| `v0.0.18-design.md` | `v0.0.18-html-export-design.md`へ改名し、HTML導入の未実装計画を集約 | 中身はHTML出力の設計。広すぎるファイル名を対象名付きにする。既存の初期案・後続判断を失わない |
| `publication-audit-2026-09-08.md` | `maintenance/2026-09-08-publication-audit.md`へ移動 | 日付付き監査の正本を維持。監査本文をimpへ戻さず、当時の評価を再判定しない |
| `Microsoft Store 公開方針.md` | `RELEASE_RULE.md`のStore将来方針へ章単位で統合 | 配布方針の分散を解消。Partner Center、表示名、署名等の固有判断を残す。現在のbeta公開をStore公開済みと書き換えない |
| `MdVisualizer beta ダウンロード.url` | 利用導線は製品READMEのダウンロードリンクへ集約。ショートカットの削除は実施時に用途確認 | URLを取得して公開状態を検証したわけではない。ユーザーが使うショートカットを推測で廃棄しない |
| `drawio_markdown_editor.html` | `research/20260803_drawio-editor/original.html`へ移動候補 | 提供原本か開発物かを履歴で確定し、本文を加工しない。単独HTMLの相対参照も確認 |
| `drawio_markdown_sample.md` | 提供原本として`research/20260803_drawio-editor/original-sample.md`へ移し、回帰用は既存`samples/drawio_markdown_sample.md`を使用 | 同名2ファイルはハッシュ不一致。差分は439行（3追加・436削除）で、単純重複ではない。製品READMEの案内先を修正し、独自ケースを保持 |
| `editing-test-cases-report.html` | 再生成先を`tmp/verification/editing/<実行>/report.html`へ変更 | 約1.50 MBの生成HTML。`scripts/generate-editing-test-report.mjs`と`report:editing`、参照を一緒に修正。旧成果物を除く前に再生成・結果の保存を確認 |
| `PLAN_IDEAS.lock`、`v0.0.11-req.lock` | 使用者を確認し、一時ロックなら追跡対象から外す | 現時点は0 byteの追跡ファイル。稼働中の排他制御を壊す削除や、`*.lock`の一括除外はしない。Cargo等の依存ロックは別物 |
| `PLAN_IDEAS.md`、`PLAN_REJECT.md`、`RELEASE_RULE.md`、`README.md` | 既存名と役割を維持 | 機能の採否や保留状態は整理目的で変更しない |
| `history/`にある完成済み版の資料・画像 | 維持 | 古い名前も履歴。移動対象からのリンクだけ必要に応じて直す |
| `research/mermaid-editor-{req,imp,sequence-design}.md` | 試作ディレクトリー内へ同名移動する候補 | 試作の記録をコードとまとめ、READMEや版別資料から参照。req/imp/設計の本文は無理に1ファイルへ統合しない |
| `research/mermaid-editor.html` | `research/20260913_mermaid-editor/reference/original.html`へ移動候補 | 報告ではユーザー提供原本。現在はGit追跡されているが、過去の「未追跡」記録は当時の事実として保存 |
| `research/20260913_mermaid-editor/`のコード・テスト・samples・vendor | 試作として維持 | 単独サーバー・ビルド・相対パス・同梱ライセンスがあるため、整理だけで製品srcへ移さない。製品への昇格は機能統合時に判断 |
| `design/v0.0.16-icons/`、`design/v0.0.16-mdvisualizer-icons/` | `history/v0.0.16/design/`へ候補群を移動する案 | 採用原本の生成が後者の`01.svg`を参照する。参照変更または原本の集約を先に行う |
| `design/v0.0.16-icon-assets/` | 採用原本・`generate.cjs`・手順・manifestを`design/mdvisualizer-icons/`へ集約する案 | PNG/ICO/MSIX用画像・previewは再生成物。製品側のアイコンは維持し、素材出力先を別途変更。手順の「組み込み未実施」も現在の記録に合わせて整理 |
| `design/MdVisualizer-icons-v0.0.16.zip` | 内容・再生成可能性を確認後、`release/design/`へ移動する案 | ZIPだけにある原本がないことを確認。生成物を無条件で削除しない |
| `scripts/`内の5本 | 維持 | 既存の開発補助と互換入口。ルートscriptsへ統一する機械的移動はしない |
| dev直下の除外済み`*.log`、既存`dev/test-videos/`、試作`test-results/` | 新規出力は規則へ合わせる。既存証跡は当面保持 | 一括削除しない。録画skillや生成元が定めるパスを変える場合はそちらも更新 |

## 6. docs全19ファイルの扱い

今回追加した目録`docs/README.md`を除く、調査開始時の19ファイルを対象にする。名前を揃えるだけの全面改名はしない。

| 現在の対象 | 推奨する整理 | 判断 |
|---|---|---|
| `DEVELOPERS_GUIDE.md`、`BUILD_COMMANDS.md`（2点） | 現行名を維持。実行可否の重複をAGENTS参照へ置換 | 今回実施。手順とルールを二重管理しない |
| `HTML_EXPORT_CLI.md` | 維持 | 独立CLIの利用者向け手順。新設フォルダーのためだけに移動しない |
| `HTML_EXPORT_INTEGRATION.md` | 現行の出力仕様・CLI APIを`design/html-export.md`へ改名・集約。未実装の本体操作・adapter・完了条件は`dev/v0.0.18-html-export-design.md`へ移管 | 現行契約と将来の実装指示の混在を解消。元の設計記録・imp/taskのリンクを更新 |
| `design/01-architecture-foundation.md`、`02-local-data-store.md`、`03-security-boundary.md`、`04-provider-architecture.md`、`05-sharepoint-sync.md`、`06-ai-assistance.md`（6点） | 未採用設計は`dev/roadmap/v0.0.14-baseline/design/`へ同名移動。実装済み契約がある節は照合してdocs側の適切な現行説明へ抽出 | 全体を現行仕様扱いにしない。ソース・後続受入と節単位で照合する前に移動完了としない |
| `design/README.md` | 提案一覧を上記roadmapの索引へ統合し、docs側は現行設計だけを案内 | 提案状態の表と現行仕様の索引を分離 |
| `ui/01-product-ux.md` | 提案部分は`dev/roadmap/v0.0.14-baseline/ui-proposal.md`へ。末尾の現行編集状態は`ui/editor-state.md`へ抽出 | 現行挙動まで提案と一緒に退避しない |
| `ui/codex.md`、`ui/codex-skills.md`（2点） | 維持 | 製品利用者向けの操作・設定手順 |
| `testing/01-test-strategy.md` | 現行検証入口を同名で維持。未導入のCI・coverage・E2E案は`dev/roadmap/v0.0.14-baseline/quality-plan.md`へ集約 | 手順を残し、導入済み範囲を明記する |
| `testing/02-test-cases.md` | 実行可能なケースと設計上の観点を照合。実施可能なものは同名維持、未採用案は上記quality-planへ集約 | 表に存在することは実装・実行の証跡ではない。実行入口がないものを完了済みにしない |
| `testing/03-internal-pdf.md`、`testing/04-document-diff.md`（2点） | 維持 | 再現可能な検証手順。参照の変更だけ追随 |
| `operations/01-quality-operations.md` | 現行の品質運用は維持。未導入のCI等は上記quality-planへ集約し、公開許可条件はAGENTS/RELEASE_RULE参照へ統一 | 計画を実運用の説明として読ませない |

## 7. 移行時の検証と順序

| 段階 | 完了条件 | 確認方法 |
|---|---|---|
| ルール・目録 | 新規の置き方が一意、現行入口と矛盾する規則が解消 | 変更差分、ローカルリンク、グローバル変更の原本保全 |
| 旧版・原本・計画の移動 | 対応表の全件が新位置へ移り、独自内容と未確認事項が残る | 移動前後のハッシュ、旧パス検索、リンク確認。必要なhistory索引を更新 |
| 混在文書の分離・統合 | 節ごとの移管先があり、正本の重複と取りこぼしがない | 移管する節の対応表、内容差分、コード・受入との照合 |
| 生成元の修正 | 再実行で旧位置に生成されず、新位置に必要な出力がある | 該当ジェネレーターだけを実行。サンプルや製品原本は不変 |
| ブランチ統合後 | 古い案内や正本・出力先が復活していない | 対象範囲の旧パス・リンク・目録・差分を再確認 |

移動対象を示す旧パスは本書や歴史的な記録にも意図的に残るため、文字列残存ゼロを合格条件にしない。実行用パス・クリック可能なリンク・現行案内の残存を区別する。製品コードに触れない移動で全体ビルド・GUI試験を要求せず、生成経路を変更した段階だけ関係する処理を検証する。

## 8. 今回の実施記録

- [x] dev/docsの配置・状態・参照・生成元・Git履歴を調査し、本書へ移動・改名・統合案を記録。
- [x] プロジェクトAGENTSへ、配置前判断、読者と状態の分類、例外と目録、移動・版移行・統合後の完了条件を追加。
- [x] dev目録の現行版案内を修正し、docs目録を作成。後者は旧計画と現行説明を識別して案内する。
- [x] 開発者ガイド・ビルド手順に残っていたGUI禁止をAGENTSへの参照へ変更。新たな実行権限を付与する変更ではない。
- [x] グローバルAGENTSと共通PROJECT_RULEに同じ配置判断を反映。編集前のハッシュを検査し、既存ルールを保持した追記と命名不一致1件の修正を実施。
- [x] 変更資料6ファイルのローカルリンク59件の参照先を確認し、欠落0件。グローバル2ファイルは準備した変更内容との完全一致を確認。`git diff --check`成功。今回の記録を日本語コミットへ含める。
- [ ] 既存資料の実移動・改名・本文統合・生成元変更。今回は「検討」の対象であり未実施。

グローバル変更は`C:/Users/amekoro/.codex/AGENTS.md`と`C:/develop/default/dev/templates/PROJECT_RULE.md`の2ファイル。前者はこの製品のGit対象外、後者の所在はGitリポジトリではないため、MdVisualizerのコミットには含まれない。今回の変更前後と適用データはGit対象外の`tmp/document-rules/`に保存した。個人のメモリーは更新していない。
