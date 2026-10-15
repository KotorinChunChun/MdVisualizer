# セキュリティ診断・改善実装レポート

診断日: 2026-10-15。対象: MdVisualizer Desktop、子Git Webプラットフォーム。ローカルソース・依存関係の診断であり、公開サイトへの侵入試験ではない。

## 診断結果

| ID | 重大度 | 根拠・成立条件 | 改善方針・状態 |
|---|---|---|---|
| MDV-01 | 高・条件付き | `src-tauri/tauri.conf.json:25` の CSP が null、assetProtocol の scope が `**`。仮にWebViewへスクリプトが侵入すると防御層が不足する。今回XSSそのものの成立は確認していない | CSP、ローカル画像、埋込エディター、外部連携の互換設計が必要。`docs/developer/design/03-security-boundary.md` の計画と実装は区別し、設計判断として保留 |
| MDV-02 | 高・依存情報 | npm audit は high 4、moderate 2、low 3。source-map-js 1.2.1、nanoid 3.3.16、undici 7.29.0 に修正版がある。悪意あるsource-map、サイズ0の独自ID生成、該当HTTP APIの使用など成立条件を伴う | 互換範囲の3ライブラリを親・子のlockで更新・検証済み。直接依存のmajor更新は行わない |
| MDV-03 | 高・依存情報 | pdfjs-dist の GHSA-hq66-cqwq-w95j。audit提案は6系へのmajor更新。現在は5.6.205、開発依存 | PDF試験への影響と移行判断が必要なため保留。製品からの到達性は未実証 |
| MDV-04 | 中〜低・依存情報 | Vitest/mocker、DOMPurify、KaTeX/Mermaidの指摘も残る | 高の互換修正とは別に評価する。audit件数を実攻撃成立件数としない |

HTMLはrehype-sanitize、SVGは`web-platform/packages/editor-ui/src/lib/svgSafety.ts`、Mermaidは`mermaidService.ts:64`のstrict設定、draw.ioは`drawio.ts:168`のorigin/source照合を確認。資格情報は`src-tauri/src/credential_store.rs`でWindows資格情報を使用。

## 実装と検証

- [x] AGENTS、開発・検証skill、既存版資料、開始時cleanな親子Gitを確認。
- [x] npm audit をオンライン実行。親9件（高4/中2/低3）、子8件（高3/中2/低3）。
- [x] source-map-js / nanoid / undici の互換更新、ビルド・関連回帰・audit再実行。
- [ ] CSP/asset権限、pdfjsのmajor更新は判断保留。

実装結果は `dev/history/v0.0.19/v0.0.19-imp.md` に記録する。既存の未来版要求は変更しない。Rust脆弱性DB、実WebView、実SharePoint、公開環境の検証は今回の依存修正の証跡に含めない。

## 参照

- [source-map-js advisory](https://github.com/advisories/GHSA-68fv-2mgg-jv7q)
- [nanoid advisory](https://github.com/advisories/GHSA-2v37-7h3g-55p8)
- [undici advisory](https://github.com/advisories/GHSA-w293-vg96-wgc3)

秘密検査: Git追跡テキスト 838 件をPEM秘密鍵・代表的なGitHub/AWS/OpenAIキー形式で検査し候補0。2MB超・バイナリ・vendor・private/temp/logs/releaseを除外。履歴全体、独自形式、未追跡の実設定は未検査であり、秘密情報が存在しない保証ではない。

実装結果: 3ライブラリを更新済み。関連18件/Web67件とフロントエンドbuild成功。親auditのhighは4→1、子rootは3→0。詳細は版別impを参照。

SPFx独立lockを追加監査し、critical 2 / high 36 / moderate 50 / low 3、計91パッケージの指摘を確認。SDK/Heft/Webpack/公開CLIの推移依存が多く、auditにはSDKの下位版への変更提案もある。SPFx基盤全体の整合と実SharePointの互換確認が必要なため、この製品面は修正保留。Desktop/Web rootのhigh減少をSPFx解消と扱わない。
