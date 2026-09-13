import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createServer } from "vite";
import { versionLogDirectory } from "./version-log-path.mjs";

const projectRoot = resolve(import.meta.dirname, "..");
const args = process.argv.slice(2);
if (args.length && (args.length !== 2 || args[0] !== '--version')) {
  throw new Error('使用方法: npm run report:editing -- --version v0.0.18');
}
const outputDirectory = versionLogDirectory(projectRoot, 'editing', args[1]);
const outputPath = resolve(outputDirectory, 'editing-test-cases-report.html');
await mkdir(outputDirectory, { recursive: true });
const vite = await createServer({
  root: projectRoot,
  appType: "custom",
  configFile: false,
  logLevel: "error",
  optimizeDeps: { noDiscovery: true, include: [] },
  server: { middlewareMode: true },
});

try {
  const module = await vite.ssrLoadModule("/src/lib/editingTestCases.ts");
  const results = module.runEditingTestCases(module.EDITING_TEST_CASES);
  const data = JSON.stringify(results).replaceAll("<", "\\u003c");
  const generatedAt = new Intl.DateTimeFormat("ja-JP", {
    dateStyle: "long",
    timeStyle: "medium",
    timeZone: "Asia/Tokyo",
  }).format(new Date());

  const html = String.raw`<!doctype html>
<html lang="ja">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Markdown編集テストケース一覧</title>
  <style>
    :root { color-scheme: light; font-family: Inter, "Yu Gothic UI", "Meiryo", sans-serif; color: #172033; background: #eef2f7; }
    * { box-sizing: border-box; }
    body { margin: 0; }
    header { padding: 28px clamp(18px, 4vw, 56px) 22px; color: #f8fafc; background: linear-gradient(125deg, #132238, #173d55 60%, #176b73); }
    h1 { margin: 0 0 8px; font-size: clamp(1.55rem, 3vw, 2.35rem); }
    header p { max-width: 78rem; margin: 0; color: #d5e5ee; line-height: 1.7; }
    main { width: min(1800px, 100%); margin: 0 auto; padding: 22px clamp(12px, 2.5vw, 34px) 48px; }
    .summary { display: grid; grid-template-columns: repeat(4, minmax(150px, 1fr)); gap: 12px; margin-bottom: 16px; }
    .card { padding: 14px 16px; background: #fff; border: 1px solid #d8e1eb; border-radius: 12px; box-shadow: 0 5px 18px #1e3a5f0b; }
    .card small { display: block; color: #607086; }
    .card strong { display: block; margin-top: 4px; font-size: 1.45rem; }
    .pass-text { color: #08784c; }
    .fail-text { color: #b42318; }
    .controls { position: sticky; top: 0; z-index: 3; display: grid; grid-template-columns: minmax(240px, 2fr) repeat(3, minmax(130px, .7fr)); gap: 10px; padding: 14px; background: #f8fafce8; border: 1px solid #d8e1eb; border-radius: 12px; box-shadow: 0 8px 24px #1e3a5f14; backdrop-filter: blur(12px); }
    label { display: grid; gap: 5px; color: #475569; font-size: .78rem; font-weight: 700; }
    input, select { width: 100%; min-height: 38px; padding: 7px 10px; color: #172033; background: #fff; border: 1px solid #bac8d8; border-radius: 7px; font: inherit; }
    .result-line { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin: 16px 2px 10px; color: #526176; }
    .pagination { display: flex; align-items: center; gap: 8px; }
    button { min-height: 34px; padding: 6px 12px; color: #fff; background: #185b75; border: 0; border-radius: 7px; cursor: pointer; }
    button:disabled { cursor: default; opacity: .38; }
    .table-wrap { overflow: auto; background: #fff; border: 1px solid #cfd9e5; border-radius: 12px; box-shadow: 0 5px 18px #1e3a5f0b; }
    table { width: 100%; min-width: 1040px; border-collapse: collapse; table-layout: fixed; }
    th { position: sticky; top: 82px; z-index: 2; padding: 11px; color: #fff; background: #233b53; border-right: 1px solid #456078; text-align: left; font-size: .82rem; }
    th:nth-child(1), th:nth-child(3) { width: 36%; }
    th:nth-child(2) { width: 13%; }
    th:nth-child(4) { width: 15%; }
    td { padding: 11px; vertical-align: top; border-right: 1px solid #dce4ec; border-bottom: 1px solid #dce4ec; }
    tbody tr:nth-child(even) { background: #f8fafc; }
    tbody tr:hover { background: #edf7f7; }
    .meta { display: flex; flex-wrap: wrap; gap: 5px 8px; margin-bottom: 7px; color: #5f6f84; font-size: .75rem; }
    .category { padding: 2px 7px; color: #175d66; background: #dff3f1; border-radius: 999px; font-weight: 700; }
    pre { max-height: 15rem; margin: 0; padding: 9px; overflow: auto; color: #162335; background: #f4f7fa; border: 1px solid #d7e0ea; border-radius: 6px; font: .78rem/1.55 Consolas, "Yu Gothic UI", monospace; white-space: pre-wrap; overflow-wrap: anywhere; tab-size: 4; }
    kbd { display: inline-block; padding: 6px 9px; color: #132238; background: #fff; border: 1px solid #aebdcd; border-bottom-width: 3px; border-radius: 6px; font: 700 .78rem/1.35 Consolas, monospace; white-space: pre-wrap; }
    .badge { display: inline-block; padding: 4px 9px; border-radius: 999px; font-size: .78rem; font-weight: 800; }
    .badge.pass { color: #08613f; background: #dff7ec; }
    .badge.fail { color: #9d1c13; background: #fee9e7; }
    details { margin-top: 8px; color: #8a2f28; font-size: .8rem; }
    details pre { margin-top: 6px; }
    .empty { color: #8491a3; font-style: italic; }
    footer { margin-top: 14px; color: #67768a; font-size: .78rem; }
    @media (max-width: 850px) { .summary { grid-template-columns: repeat(2, 1fr); } .controls { position: static; grid-template-columns: 1fr 1fr; } th { top: 0; } }
    @media print { header { color: #111; background: none; } header p { color: #333; } .controls, .pagination { display: none; } main { padding: 0; } .table-wrap { overflow: visible; box-shadow: none; } table { min-width: 0; } th { position: static; color: #111; background: #ddd; } pre { max-height: none; } }
  </style>
</head>
<body>
  <header>
    <h1>Markdown編集テストケース一覧</h1>
    <p>カーソルは「¦」、選択範囲は「⟦選択⟧」、切り取り・見出し移動の貼り付け先は「◆」で表示します。テスト定義を実行し、実際の変更後テキストと結果を収録しています。</p>
  </header>
  <main>
    <section class="summary" aria-label="テスト集計">
      <div class="card"><small>全テストケース</small><strong id="total"></strong></div>
      <div class="card"><small>成功</small><strong id="passed" class="pass-text"></strong></div>
      <div class="card"><small>失敗</small><strong id="failed" class="fail-text"></strong></div>
      <div class="card"><small>分類</small><strong id="categories"></strong></div>
    </section>
    <section class="controls" aria-label="一覧の絞り込み">
      <label>全文検索<input id="query" type="search" placeholder="説明、キー、テキスト、ID"></label>
      <label>分類<select id="category"><option value="">すべて</option></select></label>
      <label>結果<select id="status"><option value="">すべて</option><option value="pass">成功</option><option value="fail">失敗</option></select></label>
      <label>1ページの件数<select id="page-size"><option>50</option><option selected>100</option><option>250</option><option>500</option></select></label>
    </section>
    <div class="result-line">
      <strong id="visible-count"></strong>
      <nav class="pagination" aria-label="ページ送り"><button id="previous">前へ</button><span id="page"></span><button id="next">次へ</button></nav>
    </div>
    <div class="table-wrap">
      <table>
        <thead><tr><th>入力前テキスト（カーソル位置に目印を表示）</th><th>入力するキー</th><th>変更後テキスト</th><th>テスト結果</th></tr></thead>
        <tbody id="rows"></tbody>
      </table>
    </div>
    <footer>生成日時: ${generatedAt}（日本時間） / 元データ: src/lib/editingTestCases.ts</footer>
  </main>
  <script id="test-data" type="application/json">${data}</script>
  <script>
    const results = JSON.parse(document.getElementById("test-data").textContent);
    const elements = Object.fromEntries(["total", "passed", "failed", "categories", "query", "category", "status", "page-size", "visible-count", "page", "previous", "next", "rows"].map(id => [id, document.getElementById(id)]));
    const categoryNames = [...new Set(results.map(result => result.category))];
    const passed = results.filter(result => result.passed).length;
    elements.total.textContent = results.length.toLocaleString("ja-JP") + "件";
    elements.passed.textContent = passed.toLocaleString("ja-JP") + "件";
    elements.failed.textContent = (results.length - passed).toLocaleString("ja-JP") + "件";
    elements.categories.textContent = categoryNames.length.toLocaleString("ja-JP") + "分類";
    categoryNames.forEach(name => elements.category.add(new Option(name, name)));

    let page = 1;
    const text = (value, className) => { const node = document.createElement("span"); node.textContent = value; if (className) node.className = className; return node; };
    const pre = value => value ? Object.assign(document.createElement("pre"), { textContent: value }) : text("（空文字）", "empty");
    function filteredResults() {
      const query = elements.query.value.trim().toLocaleLowerCase("ja");
      return results.filter(result => {
        if (elements.category.value && result.category !== elements.category.value) return false;
        if (elements.status.value === "pass" && !result.passed) return false;
        if (elements.status.value === "fail" && result.passed) return false;
        return !query || [result.id, result.category, result.description, result.before, result.key, result.actualAfter, result.expectedAfter].some(value => value.toLocaleLowerCase("ja").includes(query));
      });
    }
    function render() {
      const filtered = filteredResults();
      const pageSize = Number(elements["page-size"].value);
      const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
      page = Math.min(page, pageCount);
      const current = filtered.slice((page - 1) * pageSize, page * pageSize);
      const fragment = document.createDocumentFragment();
      current.forEach(result => {
        const row = document.createElement("tr");
        const before = document.createElement("td");
        const meta = document.createElement("div"); meta.className = "meta";
        meta.append(text(result.category, "category"), text(result.description), text(result.id));
        before.append(meta, pre(result.before));
        const key = document.createElement("td"); const kbd = document.createElement("kbd"); kbd.textContent = result.key; key.append(kbd);
        const after = document.createElement("td"); after.append(pre(result.actualAfter));
        if (!result.passed) {
          const details = document.createElement("details"); const summary = document.createElement("summary"); summary.textContent = "期待する変更後テキスト";
          details.append(summary, pre(result.expectedAfter)); after.append(details);
        }
        const status = document.createElement("td"); status.append(text(result.passed ? "成功" : "失敗", "badge " + (result.passed ? "pass" : "fail")));
        if (result.error) { const error = document.createElement("p"); error.textContent = result.error; status.append(error); }
        row.append(before, key, after, status); fragment.append(row);
      });
      elements.rows.replaceChildren(fragment);
      elements["visible-count"].textContent = filtered.length.toLocaleString("ja-JP") + "件を表示";
      elements.page.textContent = page.toLocaleString("ja-JP") + " / " + pageCount.toLocaleString("ja-JP") + "ページ";
      elements.previous.disabled = page <= 1;
      elements.next.disabled = page >= pageCount;
    }
    [elements.query, elements.category, elements.status, elements["page-size"]].forEach(element => element.addEventListener("input", () => { page = 1; render(); }));
    elements.previous.addEventListener("click", () => { page -= 1; render(); scrollTo({ top: 0, behavior: "smooth" }); });
    elements.next.addEventListener("click", () => { page += 1; render(); scrollTo({ top: 0, behavior: "smooth" }); });
    render();
  </script>
</body>
</html>`;

  await writeFile(outputPath, html, "utf8");
  console.log(`${outputPath} に ${results.length} 件の結果を出力しました。`);
} finally {
  await vite.close();
}
