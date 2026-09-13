import assert from "node:assert/strict";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import postcss from "postcss";

const root = fileURLToPath(new URL("..", import.meta.url));
const packageJson = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
const version = (process.env.MDVISUALIZER_VERSION || packageJson.version).replace(/^v/, "").split("+")[0];
assert.match(version, /^\d+\.\d+\.\d+(?:\.\d+)?(?:-[a-zA-Z0-9.-]+)?$/, `ログ出力版が安全な形式ではありません: ${version}`);
const runId = new Date().toISOString().replace(/[:.]/g, "-");
const outputDirectory = resolve(root, `dev/history/v${version}/logs/button-css-stats-${runId}`);
const reportPath = join(outputDirectory, "button-css-style-stats.json");
const markdownPath = join(outputDirectory, "button-css-style-stats.md");
const sourceDirectories = [join(root, "src"), join(root, "web", "src"), join(root, "spfx", "src")];
const ignoredDirectories = new Set(["node_modules", ".git", "dev", "private", "temp", "vendor", "generated", "dist", "release"]);
const trackedProperties = ["height", "min-height", "font-size", "line-height", "padding", "border-radius"];
const rareMinimumCount = 5;
const controlSelector = /(^|[\s>+~,])(?:button|select|input|textarea|a)(?=[\s.#:[>+~,]|$)|(?:^|[.#])[^\s.#:[>+~,]*(?:btn|button|select|input|control|action|toggle)(?:[-_][^\s.#:[>+~,]*)*(?=[.#:[\s>+~,]|$)|\[\s*role\s*=\s*["']?button/i;
const containerSelector = /(?:toolbar|actions?|controls?|modal|dialog|status|editor|content|preview|footer|header|nav)/i;
for (const selector of [".diagram-action-button", ".document-action-button", ".status-bar__icon-button"]) assert(controlSelector.test(selector), `control selector自己検証に失敗しました: ${selector}`);

async function cssFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.filter((entry) => !entry.isDirectory() || !ignoredDirectories.has(entry.name)).map(async (entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return cssFiles(path);
    return /\.(?:css|scss)$/.test(entry.name) ? [path] : [];
  }));
  return nested.flat();
}

function scopeFor(selector, file) {
  const text = `${selector} ${file}`.toLowerCase();
  if (/status/.test(text)) return "status";
  if (/dialog|modal|overlay/.test(text)) return "dialog";
  if (/toolbar|actions?|controls?|header|footer|nav/.test(text)) return "toolbar";
  if (/editor/.test(text)) return "editor";
  if (/content|preview|markdown-body/.test(text)) return "content";
  return "other";
}

function targetKindFor(selector) {
  if (controlSelector.test(selector)) return "control";
  if (containerSelector.test(selector)) return "container";
  return null;
}

function atRuleContext(node) {
  const contexts = [];
  for (let parent = node.parent; parent; parent = parent.parent) {
    if (parent.type === "atrule") contexts.unshift(`@${parent.name}${parent.params ? ` ${parent.params.trim()}` : ""}`);
  }
  return contexts.join(" / ") || "base";
}

function isUnresolved(value) {
  return /var\(|calc\(|clamp\(|(?:^|\s)(?:auto|inherit|initial|unset|normal)(?:\s|$)|(?:^|\s)-?(?:\d+(?:\.\d+)?|\.\d+)(?:rem|em|%|vh|vw|vmin|vmax|ch|ex)(?:\s|$)/i.test(value);
}

function addDistribution(bucket, record) {
  const propertyBucket = bucket[record.property] ??= { values: {}, unresolvedValues: {}, rare: [] };
  const valueBucket = propertyBucket.values[record.value] ??= { count: 0 };
  valueBucket.count++;
  if (record.unresolved) {
    const unresolvedBucket = propertyBucket.unresolvedValues[record.value] ??= { count: 0 };
    unresolvedBucket.count++;
  }
}

const files = (await Promise.all(sourceDirectories.map(cssFiles))).flat().sort();
assert(files.length > 0, "CSS統計監査の対象ファイルがありません");
const records = [];
const parseErrors = [];
for (const file of files) {
  const source = await readFile(file, "utf8");
  try {
    const rootNode = postcss.parse(source, { from: file });
    rootNode.walkRules((rule) => {
      const targetKind = targetKindFor(rule.selector);
      if (!targetKind) {
        if (!containerSelector.test(rule.selector)) return;
      }
      const scope = scopeFor(rule.selector, relative(root, file));
      const context = atRuleContext(rule);
      for (const declaration of rule.nodes ?? []) {
        if (declaration.type !== "decl") continue;
        const property = declaration.prop.toLowerCase();
        if (!trackedProperties.includes(property)) continue;
        const value = declaration.value.trim().replace(/\s+/g, " ");
        if (!value) return;
        records.push({
          file: relative(root, file).replaceAll("\\", "/"),
          line: declaration.source?.start?.line ?? null,
          selector: rule.selector.replace(/\s+/g, " ").trim(),
          scope,
          targetKind: targetKind || "container",
          context,
          importance: declaration.important ? "important" : "normal",
          property,
          value,
          unresolved: isUnresolved(value),
        });
      }
    });
  } catch (error) {
    parseErrors.push({ file: relative(root, file).replaceAll("\\", "/"), message: String(error) });
  }
}

const byScope = {};
for (const record of records) {
  const scope = byScope[record.scope] ??= {};
  addDistribution(scope[record.targetKind] ??= {}, record);
}
for (const [scopeName, scope] of Object.entries(byScope)) {
  for (const [targetKind, properties] of Object.entries(scope)) {
    for (const [property, propertyBucket] of Object.entries(properties)) {
      propertyBucket.totalCount = Object.values(propertyBucket.values).reduce((sum, value) => sum + value.count, 0);
      propertyBucket.distinctValueCount = Object.keys(propertyBucket.values).length;
      propertyBucket.comparisonEligible = propertyBucket.totalCount >= rareMinimumCount && propertyBucket.distinctValueCount > 1;
      for (const value of Object.values(propertyBucket.values)) value.percentage = Number(((value.count / propertyBucket.totalCount) * 100).toFixed(2));
      propertyBucket.rare = propertyBucket.comparisonEligible
        ? records.filter((record) => record.scope === scopeName && record.targetKind === targetKind && record.property === property && propertyBucket.values[record.value].count <= 1)
          .map(({ file, line, selector, value, unresolved, context, importance }) => ({ file, line, selector, value, unresolved, context, importance }))
        : [];
    }
  }
}

const report = {
  status: parseErrors.length ? "WARN" : "PASS",
  version: `v${version}`,
  generatedAt: new Date().toISOString(),
  roots: sourceDirectories.map((directory) => relative(root, directory).replaceAll("\\", "/")),
  files: files.map((file) => relative(root, file).replaceAll("\\", "/")),
  trackedProperties,
  controlSelector: controlSelector.source,
  containerSelector: containerSelector.source,
  rareValueThreshold: 1,
  rareMinimumCount,
  rareRequiresDistinctValues: true,
  parserNote: "PostCSS標準構文でCSS/SCSSを構文解析します。SCSSのmixin・function・変数の意味解決は行いません。",
  notTrackedProperties: ["font", "padding-inline", "padding-block", "padding-top", "padding-right", "padding-bottom", "padding-left"],
  declarationCount: records.length,
  byScope,
  parseErrors,
};

function markdownReport(data) {
  const lines = [
    `# 操作UI CSS値統計 (${data.version})`,
    "",
    `生成日時: ${data.generatedAt}`,
    `対象ファイル: ${data.files.length}件、対象宣言: ${data.declarationCount}件`,
    "",
    `このレポートはbutton/select等の操作UIに関係するCSS値を用途scopeとcontrol/container種別ごとに集計した候補資料です。少数値候補は母数${data.rareMinimumCount}件以上かつ値が2種類以上の群だけで、値の出現頻度と割合(%)を併記します。少数値は外れ値候補として記録するだけで、統一を自動強制しません。比較データ不足の群は候補を出しません。\`var()\`、相対単位、\`calc()\`等は値を解決せず原文のまま比較しています。media条件と\`!important\`も各定義へ記録します。`,
    `対象外の代表例: ${data.notTrackedProperties.join(", ")}。font shorthand、paddingの方向別指定などは別統計として扱っていません。`,
    data.parserNote,
    "",
  ];
  for (const [scope, targetKinds] of Object.entries(data.byScope)) {
    lines.push(`## ${scope}`);
    lines.push("");
    for (const [targetKind, properties] of Object.entries(targetKinds)) {
      lines.push(`### ${targetKind}`);
      lines.push("");
      lines.push("| プロパティ | 値の分布 | 少数値候補 |");
      lines.push("| --- | --- | --- |");
      for (const [property, bucket] of Object.entries(properties)) {
        const distribution = Object.entries(bucket.values).sort((left, right) => right[1].count - left[1].count || left[0].localeCompare(right[0])).map(([value, details]) => `${value} (${details.count}, ${details.percentage}%)`).join("<br>");
        const rare = bucket.comparisonEligible ? (bucket.rare.map((item) => `${item.value} — ${item.file}:${item.line} [${item.context}; ${item.importance}]`).join("<br>") || "なし") : `比較データ不足（母数${bucket.totalCount}件、値${bucket.distinctValueCount}種類）`;
        lines.push(`| ${property} | ${distribution} | ${rare} |`);
      }
      lines.push("");
    }
    lines.push("");
  }
  if (data.parseErrors.length) {
    lines.push("## CSS解析エラー", "", ...data.parseErrors.map((error) => `- ${error.file}: ${error.message}`), "");
  }
  return `${lines.join("\n")}\n`;
}

await mkdir(outputDirectory, { recursive: true });
await writeFile(reportPath, JSON.stringify(report, null, 2), "utf8");
await writeFile(markdownPath, markdownReport(report), "utf8");
console.log(`CSS値統計: ${parseErrors.length ? "WARN" : "PASS"}（${files.length}ファイル、${records.length}宣言、JSON=${reportPath}、Markdown=${markdownPath}）`);
