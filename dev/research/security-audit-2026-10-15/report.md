# セキュリティ診断・改善実装レポート

診断日: 2026-10-15。対象: MdVisualizer Desktop、子Git Webプラットフォーム。ローカルソース・依存関係の診断であり、公開サイトへの侵入試験ではない。

## 診断結果

| ID | 重大度 | 根拠・成立条件 | 改善方針・状態 |
|---|---|---|---|
| MDV-01 | 高・条件付き | `src-tauri/tauri.conf.json:25` の CSP が null、assetProtocol の scope が `**`。仮にWebViewへスクリプトが侵入すると防御層が不足する。今回XSSそのものの成立は確認していない | CSP、ローカル画像、埋込エディター、外部連携の互換設計が必要。`docs/developer/design/03-security-boundary.md` の計画と実装は区別し、設計判断として保留 |
| MDV-02 | 高・依存情報 | npm audit は high 4、moderate 2、low 3。source-map-js 1.2.1、nanoid 3.3.16、undici 7.29.0 に修正版がある。悪意あるsource-map、サイズ0の独自ID生成、該当HTTP APIの使用など成立条件を伴う | 互換範囲の3ライブラリを親・子のlockで更新・検証済み。直接依存のmajor更新は行わない |
| MDV-03 | 高・依存情報 | pdfjs-dist の GHSA-hq66-cqwq-w95j。audit提案は6系へのmajor更新。現在は5.6.205、開発依存 | PDF試験への影響と移行判断が必要なため保留。製品からの到達性は未実証 |
| MDV-04 | 中〜低・依存情報 | Vitest/mocker、DOMPurify、KaTeX/Mermaidの指摘も残る | 高の互換修正とは別に評価する。audit件数を実攻撃成立件数としない |
| MDV-05 | 高〜低・依存情報、機能条件付き | `src-tauri/Cargo.lock:1767` の h2 0.4.15、同3463の quinn-proto 0.11.16、同3862の rustls 0.23.43 がOSV/RustSecの対象。HTTP/2の無制限DATA、QUICのpanic・メモリ枯渇、TLSハンドシェイク・セッションDebug・証明書展開など、それぞれ異なる成立条件を持つ | h2 0.4.16、quinn-proto 0.11.18、rustls 0.23.46へ互換更新。rustlsが要求するrustls-webpkiも0.103.13→0.103.15。更新後4クレートのOSV指摘0を確認。アプリでの攻撃成立や実通信の再現は未実施 |
| MDV-06 | 要評価・対象OS／保守状態に依存 | 同1651のglib 0.18.5にGHSA-wrw7-89jp-8q8g／RUSTSEC-2024-0429、paste・proc-macro-error・unic系5クレートに未保守の指摘 | Windows既定の依存treeにglibは非選択。LinuxのGTK/Tauri依存整合、および上流の未保守依存の置換判断が必要なため保留。未保守という状態を攻撃成立と同一視しない |

HTMLはrehype-sanitize、SVGは`web-platform/packages/editor-ui/src/lib/svgSafety.ts`、Mermaidは`mermaidService.ts:64`のstrict設定、draw.ioは`drawio.ts:168`のorigin/source照合を確認。資格情報は`src-tauri/src/credential_store.rs`でWindows資格情報を使用。

## 実装と検証

- [x] AGENTS、開発・検証skill、既存版資料、開始時cleanな親子Gitを確認。
- [x] npm audit をオンライン実行。親9件（高4/中2/低3）、子8件（高3/中2/低3）。
- [x] source-map-js / nanoid / undici の互換更新、ビルド・関連回帰・audit再実行。
- [x] Cargo.lockのregistry依存621件をOSVへ照合し、通信依存3件と必要な関連1件を互換更新。再照合後はglib・未保守の計8クレートに指摘が残る。
- [x] 最終lockの差分を4クレートのversion/checksumに限定し、分離targetで`cargo test --locked --manifest-path src-tauri/Cargo.toml`: 194成功・0失敗・2ignored、終了コード0。MSVCの.lib/.exp作成stdoutに由来するlinker警告のみ。ignoredは実ChatGPT／Codex CLI接続で今回未実行。
- [ ] CSP/asset権限、pdfjsのmajor更新は判断保留。

実装結果は `dev/history/v0.0.19/v0.0.19-imp.md` に記録する。既存の未来版要求は変更しない。Rust依存はnpm修正後に追加調査した。実WebView、実SharePoint、公開環境の検証は今回の依存修正の証跡に含めない。

Rust依存の境界: `cargo tree --locked --offline --target x86_64-pc-windows-msvc -i <crate>` でh2／rustlsはreqwestから有効、quinn-proto／glibは非選択と確認。lockの全OS／任意機能を含む指摘を現在のWindows実行経路と混同しない。製品ソースに独自ClientSessionStore／TLSセッション値のDebug処理は見つからず、rustlsのBrotli機能も直接指定していないが、全advisoryの実到達性を証明したものではない。

## 参照

- [source-map-js advisory](https://github.com/advisories/GHSA-68fv-2mgg-jv7q)
- [nanoid advisory](https://github.com/advisories/GHSA-2v37-7h3g-55p8)
- [undici advisory](https://github.com/advisories/GHSA-w293-vg96-wgc3)
- [h2: RUSTSEC-2026-0258](https://rustsec.org/advisories/RUSTSEC-2026-0258.html)
- [quinn-proto: RUSTSEC-2026-0338](https://rustsec.org/advisories/RUSTSEC-2026-0338.html)（同0339／0340／0341／0342も確認）
- [rustls: RUSTSEC-2026-0285](https://rustsec.org/advisories/RUSTSEC-2026-0285.html)（GHSA-2mjx-qc3c-rqvcと同件）、[0346](https://rustsec.org/advisories/RUSTSEC-2026-0346.html)、[0348](https://rustsec.org/advisories/RUSTSEC-2026-0348.html)、[0349](https://rustsec.org/advisories/RUSTSEC-2026-0349.html)

秘密検査: Git追跡テキスト 838 件をPEM秘密鍵・代表的なGitHub/AWS/OpenAIキー形式で検査し候補0。2MB超・バイナリ・vendor・private/temp/logs/releaseを除外。履歴全体、独自形式、未追跡の実設定は未検査であり、秘密情報が存在しない保証ではない。

実装結果: 3ライブラリを更新済み。関連18件/Web67件とフロントエンドbuild成功。親auditのhighは4→1、子rootは3→0。詳細は版別impを参照。

SPFx独立lockを追加監査し、critical 2 / high 36 / moderate 50 / low 3、計91パッケージの指摘を確認。SDK/Heft/Webpack/公開CLIの推移依存が多く、auditにはSDKの下位版への変更提案もある。SPFx基盤全体の整合と実SharePointの互換確認が必要なため、この製品面は修正保留。Desktop/Web rootのhigh減少をSPFx解消と扱わない。
