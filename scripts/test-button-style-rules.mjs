import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const root = fileURLToPath(new URL("..", import.meta.url));

async function sourceFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return entry.isFile() && /\.tsx?$/.test(entry.name) ? [path] : [];
  }));
  return nested.flat();
}

const sourceDirectories = [join(root, "src"), join(root, "web", "src")];
const [appStyles, appSource, fileSets] = await Promise.all([
  readFile(join(root, "src", "styles", "app.css"), "utf8"),
  readFile(join(root, "src", "App.tsx"), "utf8"),
  Promise.all(sourceDirectories.map(sourceFiles)),
]);
const files = fileSets.flat();

// 全ボタンは共通の hover / focus / disabled 状態を継承し、ツールバーの例外は専用クラスで宣言する。
for (const selector of ["button:not(:disabled)", "button:not(:disabled):hover", "button:focus-visible", "button:disabled"]) {
  assert.match(appStyles, new RegExp(`(^|\\n)${selector.replace(/[()]/g, "\\$&")}`), `共通ボタン状態がありません: ${selector}`);
}

assert.match(appStyles, /\.document-action-button,\s*\.document-actions button,\s*\.codex-toolbar-action/s, "文書ツールバーの共通ボタン規則がありません");
const skillStyles = await readFile(join(root, "src", "features", "codex", "skills.css"), "utf8");
const skillButtonRule = skillStyles.match(/\.codex-skill-settings button\s*\{([^}]+)\}/)?.[1] ?? "";
for (const property of ["color:var(--text-primary)", "background:var(--btn-bg)", "border:1px solid var(--border-color)", "border-radius:4px"]) {
  assert(skillButtonRule.includes(property), `スキル設定ボタンの共通外観がありません: ${property}`);
}
assert.match(appStyles, /\.editor-mode-controls > \.document-action-button \{ margin-left: 8px; \}/, "差分ボタンの配置規則がありません");
const diffButtonStart = appSource.indexOf('className="document-action-button"');
const diffButtonEnd = appSource.indexOf("</button>", diffButtonStart);
assert(diffButtonStart >= 0 && diffButtonEnd >= diffButtonStart && appSource.slice(diffButtonStart, diffButtonEnd).includes("差分"), "差分ボタンが共通クラスを使用していません");

function buttonStyleAudit(filename, source) {
  const sourceFile = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true, filename.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const inlineStyles = [];
  let buttons = 0;
  const visit = (node) => {
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      if (node.tagName.getText(sourceFile) === "button") {
        buttons++;
        for (const attribute of node.attributes.properties) {
          if (ts.isJsxAttribute(attribute) && attribute.name.text === "style") {
            const line = sourceFile.getLineAndCharacterOfPosition(attribute.getStart(sourceFile)).line + 1;
            inlineStyles.push(`${filename}:${line}`);
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return { buttons, inlineStyles };
}

const fixtureAudit = buttonStyleAudit("inline-style-fixture.tsx", "export const Fixture = () => <button style={{ marginLeft: 8 }}>fixture</button>;");
assert.deepEqual(fixtureAudit.inlineStyles, ["inline-style-fixture.tsx:1"], "自己検証: JSXのボタンinline styleを検出できません");

assert(files.length > 0, "ボタン検査の対象ソースがありません");
const inlineStyledButtons = [];
let buttons = 0;
for (const file of files) {
  const source = await readFile(file, "utf8");
  const audit = buttonStyleAudit(relative(root, file), source);
  buttons += audit.buttons;
  inlineStyledButtons.push(...audit.inlineStyles);
}
assert(buttons > 0, "ボタン検査でJSXのbutton要素を検出できません");
assert.deepEqual(inlineStyledButtons, [], `ボタンの見た目をインライン指定しないでください: ${inlineStyledButtons.join(", ")}`);

process.stdout.write(`ボタン共通スタイル規則: PASS（${files.length}ファイル、${buttons}ボタンを走査）\n`);
