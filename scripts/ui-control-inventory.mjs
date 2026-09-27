import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import ts from "typescript";
import { JSDOM } from "jsdom";

const root = path.resolve(import.meta.dirname, "..");

const sharedRoot = path.join(root, "web-platform", "packages", "editor-ui", "src");
const targets = [
  { id: "desktop", root: path.join(root, "src"), sourceKind: "desktop" },
  { id: "shared", root: sharedRoot, sourceKind: "shared" },
  { id: "web", root: path.join(root, "web-platform", "apps", "web", "src"), sourceKind: "web" },
  { id: "spfx", root: path.join(root, "web-platform", "apps", "spfx", "src"), sourceKind: "spfx" },
  { id: "mermaid-editor", root: path.join(root, "web-platform", "tools", "mermaid-editor"), sourceKind: "shared" },
];
const sourceMap = JSON.parse(fs.readFileSync(path.join(root, "web-platform", "packages", "editor-ui", "source-map.json"), "utf8"));
const sharedProjectedDesktopPaths = new Set(sourceMap.files.filter(file => /\.(?:ts|tsx)$/.test(file)).map(file => path.normalize(path.join(root, "src", file))));
const ignoredPart = /(^|[\\/])(node_modules|vendor|generated|tests?|private|temp)([\\/]|$)/i;
const interactiveTags = new Set(["button", "select", "option", "input", "textarea", "dialog", "menu", "summary", "a"]);
const roleControls = new Set(["button", "menu", "menuitem", "menuitemcheckbox", "menuitemradio", "toolbar", "dialog", "alertdialog", "tab", "switch", "checkbox", "radio", "listbox", "combobox"]);

function walk(directory) {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const full = path.join(directory, entry.name);
    if (ignoredPart.test(full) || entry.name === "editingTestCases.ts" || entry.name === "build.mjs") return [];
    if (entry.isDirectory()) return walk(full);
    return /\.(?:ts|tsx|js|html)$/.test(entry.name) && !/\.(?:test|spec)\.[tj]sx?$/.test(entry.name) ? [full] : [];
  });
}

function textOf(node) {
  if (!node) return null;
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (ts.isNumericLiteral(node)) return node.text;
  if (ts.isJsxText(node)) return node.getText().replace(/\s+/g, " ").trim() || null;
  if (ts.isTemplateExpression(node)) return `${node.head.text}\${${node.templateSpans.map(span => `{${span.expression.getText()}}${span.literal.text}`).join("")}}`;
  if (ts.isJsxExpression(node)) return node.expression ? textOf(node.expression) : null;
  if (ts.isIdentifier(node) || ts.isPropertyAccessExpression(node) || ts.isConditionalExpression(node) || ts.isBinaryExpression(node) || ts.isCallExpression(node)) return `{{${node.getText()}}}`;
  return null;
}

function propValue(attributes, names) {
  for (const attribute of attributes.properties) {
    if (!ts.isJsxAttribute(attribute) || !names.includes(attribute.name.text)) continue;
    if (!attribute.initializer) return "true";
    if (ts.isStringLiteral(attribute.initializer)) return attribute.initializer.text;
    if (ts.isJsxExpression(attribute.initializer)) return textOf(attribute.initializer.expression);
  }
  return null;
}

function jsxChildLabel(node) {
  const children = node.children ?? [];
  const labels = children.map(textOf).filter(Boolean);
  return labels.length ? labels.join(" ") : null;
}

function signatureFor(value) {
  return `sha256:${crypto.createHash("sha256").update(value.replace(/\s+/g, " ").trim()).digest("hex")}`;
}

function callName(node) {
  if (ts.isIdentifier(node.expression)) return node.expression.text;
  if (ts.isPropertyAccessExpression(node.expression)) return node.expression.name.text;
  return "";
}

function objectLabel(node) {
  if (!node || !ts.isObjectLiteralExpression(node)) return null;
  const property = node.properties.find(item => ts.isPropertyAssignment(item) && item.name.getText().replace(/["']/g, "") === "label");
  return property && ts.isPropertyAssignment(property) ? textOf(property.initializer) : null;
}

function functionName(node) {
  let current = node.parent;
  while (current) {
    if ((ts.isFunctionDeclaration(current) || ts.isFunctionExpression(current)) && current.name) return current.name.text;
    if (ts.isVariableDeclaration(current) && ts.isIdentifier(current.name) && (ts.isArrowFunction(current.initializer) || ts.isFunctionExpression(current.initializer))) return current.name.text;
    if (ts.isMethodDeclaration(current) && current.name) return current.name.getText();
    current = current.parent;
  }
  return "module";
}

function hasEvent(attributes) {
  return attributes.properties.some(attribute => ts.isJsxAttribute(attribute) && /^(onClick|onPointerDown|onKeyDown|onChange|onSubmit)$/.test(attribute.name.text));
}

function htmlControlRecords(markup, file, sourceKind, line, scope, origin) {
  const relative = path.relative(root, file).replaceAll("\\", "/");
  const dom = new JSDOM(`<body>${markup}</body>`).window.document;
  return [...dom.querySelectorAll("button,select,option,input,textarea,dialog,menu,summary,[role='button'],[role='menuitem'],[role='toolbar'],[role='dialog']")].map((element, index) => {
    const tag = element.tagName.toLowerCase();
    const role = element.getAttribute("role");
    const visible = element.textContent?.replace(/\s+/g, " ").trim();
    const label = visible || element.getAttribute("aria-label") || element.getAttribute("title") || element.getAttribute("placeholder") || null;
    const dynamic = /__ui_dynamic__/.test(markup) || /\{\{.+\}\}/.test(label ?? "");
    const kind = role === "dialog" || tag === "dialog" ? "dialog"
      : role === "toolbar" ? "toolbar" : role?.startsWith("menu") || tag === "menu" ? "menu"
      : tag === "select" || tag === "option" ? "select" : tag === "input" || tag === "textarea" ? "input" : "button";
    return {
      id: null, featureGroup: "mermaid-editor", controlKind: kind, tag, role: role ?? null,
      displayName: label, labelKind: !label ? "missing" : dynamic ? "dynamic" : "static", labelExpression: dynamic ? label ?? "__ui_dynamic__" : null,
      orderScope: { component: scope, sourceFile: relative, sourceLine: line, sourceColumn: 1, ordinal: index + 1 },
      source: { kind: sourceKind, file: relative, line, column: 1 }, interactions: [origin], signature: signatureFor(`${origin}|${element.outerHTML}`),
      targetSourcePresence: { desktop: "shared-source", html: "shared-source", php: "shared-source", spfx: "shared-source" }, comparisonStatus: "unmapped",
      exclusionReason: !label ? "HTMLテンプレートの表示名を静的抽出できない" : dynamic ? "テンプレートの動的生成。選択肢・メニュー項目は実行時に別途確認する" : null,
    };
  });
}

export function collectFile(file, sourceKind) {
  const source = fs.readFileSync(file, "utf8");
  const extension = path.extname(file).toLowerCase();
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, extension === ".tsx" ? ts.ScriptKind.TSX : extension === ".js" ? ts.ScriptKind.JS : ts.ScriptKind.TS);
  const records = [];
  if (extension === ".html") records.push(...htmlControlRecords(source, file, sourceKind, 1, "static HTML", "static-html"));
  // map()で生成されるメニュー/書式ボタンはテンプレートだけでなく定義項目も登録する。
  const visitDefinitions = node => {
    if (ts.isObjectLiteralExpression(node)) {
      const props = new Map(node.properties.filter(ts.isPropertyAssignment).map(p => [p.name.getText(ast).replace(/["']/g, ''), p.initializer]));
      if (props.has('label') && ['action', 'run', 'value', 'onClick'].some(k => props.has(k))) {
        const position = ast.getLineAndCharacterOfPosition(node.getStart(ast));
        const relative = path.relative(root, file).replaceAll('\\', '/');
        const label = textOf(props.get('label'));
        records.push({ id: null, featureGroup: '定義から生成する操作', controlKind: 'command-definition', tag: 'command-definition', role: null,
          displayName: label, labelKind: label ? 'static' : 'dynamic', labelExpression: props.get('label').getText(ast),
          orderScope: { component: functionName(node), sourceFile: relative, sourceLine: position.line + 1, sourceColumn: position.character + 1, ordinal: 0 },
          source: { kind: sourceKind, file: relative, line: position.line + 1, column: position.character + 1 },
          interactions: [...props.keys()].filter(k => ['action', 'run', 'onClick', 'value'].includes(k)), signature: signatureFor(node.getText(ast)),
          targetSourcePresence: {}, comparisonStatus: 'unmapped', exclusionReason: null });
      }
    }
    ts.forEachChild(node, visitDefinitions);
  };
  visitDefinitions(ast);
  const visit = node => {
    if (!ts.isJsxOpeningElement(node) && !ts.isJsxSelfClosingElement(node)) return ts.forEachChild(node, visit);
    const tag = node.tagName.getText();
    const lowerTag = tag.toLowerCase();
    const attributes = node.attributes;
    const role = propValue(attributes, ["role"]);
    const event = hasEvent(attributes);
    const qualifies = interactiveTags.has(lowerTag) || roleControls.has(role ?? "") || (event && /^[a-z]/.test(tag));
    if (qualifies) {
      const parent = node.parent;
      // A JSX value such as "off" is state, not its visible label. Prefer rendered
      // child text, then accessible text, and never promote value to displayName.
      const label = (ts.isJsxElement(parent) ? jsxChildLabel(parent) : null)
        ?? propValue(attributes, ["aria-label", "title", "label", "placeholder", "name"])
        ?? null;
      const position = ast.getLineAndCharacterOfPosition(node.getStart(ast));
      const relative = path.relative(root, file).replaceAll("\\", "/");
      const scope = functionName(node);
      const kind = role === "dialog" || role === "alertdialog" || lowerTag === "dialog" ? "dialog"
        : role === "toolbar" ? "toolbar" : role?.startsWith("menu") || lowerTag === "menu" ? "menu"
        : lowerTag === "select" || lowerTag === "option" || role === "combobox" || role === "listbox" ? "select"
        : lowerTag === "input" || lowerTag === "textarea" ? "input" : "button";
      const labelKind = !label ? "missing" : /\$\{|\{.+\}/.test(label) ? "dynamic" : "static";
      records.push({
        id: null,
        featureGroup: relative.split("/").slice(-2, -1)[0] || "root",
        controlKind: kind,
        tag,
        role: role ?? null,
        displayName: label,
        labelKind,
        labelExpression: labelKind === "dynamic" ? label : null,
        orderScope: { component: scope, sourceFile: relative, sourceLine: position.line + 1, sourceColumn: position.character + 1, ordinal: 0 },
        source: { kind: sourceKind, file: relative, line: position.line + 1, column: position.character + 1 },
        interactions: attributes.properties.filter(attribute => ts.isJsxAttribute(attribute) && /^on[A-Z]/.test(attribute.name.text)).map(attribute => attribute.name.text),
        signature: signatureFor(`${tag}|${role ?? ""}|${label ?? ""}|${propValue(attributes, ["className", "class"]) ?? ""}|${node.getText(ast)}`),
        targetSourcePresence: { desktop: "not-in-host-source", html: "not-in-host-source", php: "not-in-host-source", spfx: "not-in-host-source" },
        comparisonStatus: "unmapped",
        exclusionReason: null,
      });
    }
    return ts.forEachChild(node, visit);
  };
  visit(ast);
  // DOM factory calls and SPFx property-pane factories do not have JSX nodes.
  const callVisit = node => {
    if (ts.isNewExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "Option") {
      const position = ast.getLineAndCharacterOfPosition(node.getStart(ast));
      const relative = path.relative(root, file).replaceAll("\\", "/");
      const text = textOf(node.arguments?.[0]);
      records.push({
        id: null, featureGroup: relative.split("/").slice(-2, -1)[0] || "root", controlKind: "select", tag: "new Option", role: null,
        displayName: text, labelKind: !text ? "missing" : /\$\{|\{.+\}/.test(text) ? "dynamic" : "static", labelExpression: text && /\$\{|\{.+\}/.test(text) ? text : null,
        orderScope: { component: functionName(node), sourceFile: relative, sourceLine: position.line + 1, sourceColumn: position.character + 1, ordinal: 0 },
        source: { kind: sourceKind, file: relative, line: position.line + 1, column: position.character + 1 }, interactions: ["new Option"], signature: signatureFor(node.getText(ast)),
        targetSourcePresence: { desktop: "not-in-host-source", html: "not-in-host-source", php: "not-in-host-source", spfx: "not-in-host-source" }, comparisonStatus: "unmapped",
        exclusionReason: !text ? "new Optionの表示名を静的抽出できない" : null,
      });
      return ts.forEachChild(node, callVisit);
    }
    if (!ts.isCallExpression(node)) return ts.forEachChild(node, callVisit);
    const name = callName(node);
    const position = ast.getLineAndCharacterOfPosition(node.getStart(ast));
    const relative = path.relative(root, file).replaceAll("\\", "/");
    const scope = functionName(node);
    const addFactory = (tag, kind, label, labelExpression = null) => {
      const labelKind = !label ? "missing" : labelExpression ? "dynamic" : "static";
      records.push({
        id: null, featureGroup: relative.split("/").slice(-2, -1)[0] || "root", controlKind: kind, tag, role: null,
        displayName: label, labelKind, labelExpression,
        orderScope: { component: scope, sourceFile: relative, sourceLine: position.line + 1, sourceColumn: position.character + 1, ordinal: 0 },
        source: { kind: sourceKind, file: relative, line: position.line + 1, column: position.character + 1 },
        interactions: [name], signature: signatureFor(node.getText(ast)),
        targetSourcePresence: { desktop: "not-in-host-source", html: "not-in-host-source", php: "not-in-host-source", spfx: "not-in-host-source" }, comparisonStatus: "unmapped",
        exclusionReason: !label ? `${name}の表示名を静的抽出できない` : null,
      });
    };
    if (/button/i.test(name) && name !== "createElement") {
      const text = textOf(node.arguments[0]);
      addFactory(`${name}()`, "button", text, text && /\$\{|\{.+\}/.test(text) ? text : null);
    } else if (/^PropertyPane/.test(name)) {
      const label = objectLabel(node.arguments[1]);
      addFactory(`${name}()`, /Dropdown|ChoiceGroup|Toggle/.test(name) ? "select" : "input", label, label && /\$\{|\{.+\}/.test(label) ? label : null);
    }
    return ts.forEachChild(node, callVisit);
  };
  callVisit(ast);
  const templateVisit = node => {
    if (ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateExpression(node)) {
      const raw = node.getText(ast).slice(1, -1);
      if (/<(?:button|select|option|input|textarea|dialog|menu|summary)\b|role\s*=/.test(raw)) {
        const position = ast.getLineAndCharacterOfPosition(node.getStart(ast));
        records.push(...htmlControlRecords(raw.replace(/\$\{[\s\S]*?\}/g, "__ui_dynamic__"), file, sourceKind, position.line + 1, functionName(node), "html-template"));
      }
    }
    return ts.forEachChild(node, templateVisit);
  };
  templateVisit(ast);
  // SPFx also assembles controls with document.createElement rather than JSX.
  // Capture the local variable and its nearby text/ARIA assignments as one control.
  const lines = source.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const match = lines[index].match(/(?:const|let|var)\s+(\w+)\s*=\s*document\.createElement\(['"](button|select|option|input|textarea|dialog|menu)['"]\)/);
    if (!match) continue;
    const [, variable, tag] = match;
    const nearby = lines.slice(index, Math.min(lines.length, index + 28)).join("\n");
    const text = nearby.match(new RegExp(`\\b${variable}\\.textContent\\s*=\\s*(['\"])(.*?)\\1`));
    const aria = nearby.match(new RegExp(`\\b${variable}\\.setAttribute\\(\\s*(['\"])aria-label\\1\\s*,\\s*(['\"])(.*?)\\2\\s*\\)`));
    const dynamicText = nearby.match(new RegExp(`\\b${variable}\\.textContent\\s*=\\s*([^;\\n]+)`));
    const label = aria?.[3] ?? text?.[2] ?? dynamicText?.[1]?.trim() ?? null;
    const relative = path.relative(root, file).replaceAll("\\", "/");
    const kind = tag === "dialog" ? "dialog" : tag === "menu" ? "menu" : tag === "select" || tag === "option" ? "select" : tag === "input" || tag === "textarea" ? "input" : "button";
    records.push({
      id: null,
      featureGroup: relative.split("/").slice(-2, -1)[0] || "root", controlKind: kind, tag, role: null,
      displayName: label, labelKind: !label ? "missing" : /^['\"]/.test(label) || text || aria ? "static" : "dynamic", labelExpression: !label || text || aria ? null : label,
      orderScope: { component: "DOM assembly", sourceFile: relative, sourceLine: index + 1, sourceColumn: 1, ordinal: 0 },
      source: { kind: sourceKind, file: relative, line: index + 1, column: 1 },
      interactions: [...nearby.matchAll(new RegExp(`\\b${variable}\\.(?:addEventListener|onclick|onchange)`, "g"))].map(() => "DOM event"), signature: signatureFor(`${tag}|${label ?? ""}|${nearby}`),
      targetSourcePresence: { desktop: "not-in-host-source", html: "not-in-host-source", php: "not-in-host-source", spfx: "not-in-host-source" }, comparisonStatus: "unmapped", exclusionReason: !label ? "DOM生成要素の表示名を静的抽出できない" : null,
    });
  }
  // Factory tags chosen from runtime data (for example form field type) are
  // deliberately recorded as dynamic, not expanded into guessed menu options.
  lines.forEach((line, index) => {
    const match = line.match(/document\.createElement\((?!['"])([^)]+)\)/);
    if (!match) return;
    const relative = path.relative(root, file).replaceAll("\\", "/");
    records.push({ id: null, featureGroup: "mermaid-editor", controlKind: "dynamic-control", tag: "DOM dynamic factory", role: null,
      displayName: null, labelKind: "missing", labelExpression: match[1].trim(), orderScope: { component: "DOM dynamic factory", sourceFile: relative, sourceLine: index + 1, sourceColumn: 1, ordinal: 0 },
      source: { kind: sourceKind, file: relative, line: index + 1, column: 1 }, interactions: ["document.createElement"], signature: signatureFor(line),
      targetSourcePresence: { desktop: "shared-source", html: "shared-source", php: "shared-source", spfx: "shared-source" }, comparisonStatus: "unmapped",
      exclusionReason: "実行時型のDOM生成。選択肢・メニュー項目は展開せず実画面確認が必要" });
  });
  return records;
}

export function scanUiControls() {
const raw = targets.flatMap(target => walk(target.root)
  .filter(file => target.id !== "desktop" || !sharedProjectedDesktopPaths.has(path.normalize(file)))
  .flatMap(file => collectFile(file, target.sourceKind)));
const ordered = raw.sort((a, b) => a.source.file.localeCompare(b.source.file) || a.source.line - b.source.line);
const ordinals = new Map();
for (const row of ordered) {
  const scopeKey = `${row.orderScope.sourceFile}:${row.orderScope.component}`;
  row.orderScope.ordinal = (ordinals.get(scopeKey) ?? 0) + 1;
  ordinals.set(scopeKey, row.orderScope.ordinal);
  row.id = `ui-${crypto.createHash("sha1").update(`${row.source.file}|${row.orderScope.component}|${row.tag}|${row.orderScope.ordinal}`).digest("hex").slice(0, 12)}`;
  if (row.source.kind === "shared") Object.assign(row.targetSourcePresence, { desktop: "shared-source", html: "shared-source", php: "shared-source", spfx: "shared-source" });
  if (row.source.kind === "desktop") row.targetSourcePresence.desktop = "present-in-host-source";
  if (row.source.kind === "web") Object.assign(row.targetSourcePresence, { html: "present-in-host-source", php: "present-in-host-source" });
  if (row.source.kind === "spfx") row.targetSourcePresence.spfx = "present-in-host-source";
  if (!row.displayName) row.exclusionReason = "表示名を静的抽出できない（子要素または実行時生成を要確認）";
}
const summary = {
  generatedAt: new Date().toISOString(),
  schemaVersion: 1,
  canonicalSources: { desktop: "src excluding source-map projection", shared: "web-platform/packages/editor-ui/src", web: "web-platform/apps/web/src", spfx: "web-platform/apps/spfx/src" },
  totals: { all: ordered.length, bySource: {}, byKind: {}, dynamicLabels: ordered.filter(row => row.labelKind === "dynamic").length, unlabeled: ordered.filter(row => row.labelKind === "missing").length },
  sourceProjectionExcluded: [...sharedProjectedDesktopPaths].map(file => path.relative(root, file).replaceAll("\\", "/")),
};
for (const row of ordered) {
  summary.totals.bySource[row.source.kind] = (summary.totals.bySource[row.source.kind] ?? 0) + 1;
  summary.totals.byKind[row.controlKind] = (summary.totals.byKind[row.controlKind] ?? 0) + 1;
}
return { schemaVersion: 1, summary, controls: ordered };
}
