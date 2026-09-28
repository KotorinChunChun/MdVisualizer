import assert from "node:assert/strict";

export const WEB_BUTTON_LAYOUT_SCOPES = [
  { id: "web-header", selector: ".web-shell-header > .tab-bar", required: true },
  { id: "web-command-area", selector: ".web-command-area", required: false },
  { id: "web-options-toggle", selector: ".web-options-toggle", required: false },
  { id: "web-preview-toolbar", selector: ".web-preview-toolbar", required: false },
  { id: "web-preview-rail", selector: ".web-preview-rail", required: false },
  { id: "web-status-controls", selector: ".web-status-bar__controls", required: true },
  { id: "web-editor-toolbar", selector: ".markdown-editor__toolbar", required: false },
  { id: "web-document-tool-bar", selector: ".web-document-tool__bar", required: false },
  { id: "web-remote-storage-summary", selector: ".web-remote-storage > summary", required: false },
  { id: "web-modal", selector: '[role="dialog"]', required: false },
];

export const DESKTOP_BUTTON_LAYOUT_SCOPES = [
  { id: "desktop-document-actions", selector: ".document-actions", required: false },
  { id: "desktop-editor-mode", selector: ".editor-mode-controls", required: false },
  { id: "desktop-view-controls", selector: ".view-controls", required: false },
  { id: "desktop-status-controls", selector: ".status-bar__controls", required: false },
  { id: "desktop-responsive-toolbar", selector: ".responsive-toolbar, .markdown-editor__toolbar", required: false },
  { id: "desktop-modal", selector: '[role="dialog"]', required: false },
];

const DEFAULT_TOLERANCE = 2;

function normalizeExceptions(exceptions) {
  for (const exception of exceptions) {
    assert(typeof exception.scope === "string" && exception.scope, "ボタンレイアウト例外にはscopeが必要です");
    assert(["height", "alignment", "overflow"].includes(exception.check), `未知のボタンレイアウト例外項目: ${exception.check}`);
    assert(typeof exception.reason === "string" && exception.reason.trim(), `ボタンレイアウト例外(${exception.scope})には理由が必要です`);
    assert(typeof exception.buttonLabel === "string" && exception.buttonLabel.trim(), `ボタンレイアウト例外(${exception.scope})にはbuttonLabelが必要です`);
  }
  return exceptions;
}

function exceptionApplies(issue, exception) {
  return issue.scope === exception.scope
    && issue.check === exception.check
    && issue.buttonLabels.includes(exception.buttonLabel);
}

export async function collectButtonLayoutAudit(page, scopes, options = {}) {
  const tolerance = options.tolerance ?? DEFAULT_TOLERANCE;
  return page.evaluate(({ requestedScopes, geometryTolerance }) => {
    const visible = (element) => {
      if (typeof element.checkVisibility === "function" && !element.checkVisibility({ checkOpacity: false, checkVisibilityCSS: true, contentVisibilityAuto: true })) return false;
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
    };
    const label = (control) => (control instanceof HTMLSelectElement ? `select:${control.value}` : control.getAttribute("aria-label") || control.textContent?.replace(/\s+/g, " ").trim() || "(無名コントロール)");
    const verticalOverlap = (left, right) => Math.max(0, Math.min(left.rect.bottom, right.rect.bottom) - Math.max(left.rect.top, right.rect.top));
    const sameRow = (left, right) => verticalOverlap(left, right) >= Math.min(left.rect.height, right.rect.height) * 0.5;
    const groupRows = (buttons) => {
      const rows = [];
      for (const button of buttons.sort((left, right) => left.rect.top - right.rect.top || left.rect.left - right.rect.left)) {
        const row = rows.find((candidate) => candidate.buttons.some((candidateButton) => sameRow(candidateButton, button)));
        if (row) {
          row.buttons.push(button);
          row.centerY = row.buttons.reduce((sum, item) => sum + item.centerY, 0) / row.buttons.length;
        } else {
          rows.push({ centerY: button.centerY, buttons: [button] });
        }
      }
      return rows;
    };
    const results = [];
    for (const requested of requestedScopes) {
      const roots = [...document.querySelectorAll(requested.selector)].filter(visible);
      if (roots.length === 0) {
        results.push({ id: requested.id, selector: requested.selector, required: Boolean(requested.required), matched: 0, rows: [], violations: [] });
        continue;
      }
      roots.forEach((root, rootIndex) => {
        const rootRect = root.getBoundingClientRect();
        const controls = [...(root.matches("button, select, summary") ? [root] : []), ...root.querySelectorAll("button, select, summary")].filter(visible).map((button) => {
          const rect = button.getBoundingClientRect();
          return { tagName: button.tagName.toLowerCase(), label: label(button), rect: { top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right, height: rect.height }, centerY: (rect.top + rect.bottom) / 2 };
        });
        const rows = groupRows(controls).map((row, rowIndex) => {
          const heights = row.buttons.map((button) => button.rect.height);
          const centerYs = row.buttons.map((button) => button.centerY);
          const height = heights.reduce((sum, value) => sum + value, 0) / heights.length;
          const centerY = centerYs.reduce((sum, value) => sum + value, 0) / centerYs.length;
          const heightMismatch = Math.max(...heights) - Math.min(...heights) > geometryTolerance;
          const alignmentMismatch = Math.max(...centerYs) - Math.min(...centerYs) > geometryTolerance;
          const overflowButtons = row.buttons.filter((button) => button.rect.left < rootRect.left - geometryTolerance || button.rect.right > rootRect.right + geometryTolerance);
          const rootOverflow = root.scrollWidth - root.clientWidth > geometryTolerance;
          return {
            rowIndex,
            buttonLabels: row.buttons.map((button) => button.label),
            heights,
            centerY,
            rootOverflow,
            overflowButtons: overflowButtons.map((button) => button.label),
            violations: [
              ...(heightMismatch ? [{ check: "height", scope: requested.id, buttonLabels: row.buttons.map((button) => button.label), detail: `高さ差=${(Math.max(...heights) - Math.min(...heights)).toFixed(2)}px` }] : []),
              ...(alignmentMismatch ? [{ check: "alignment", scope: requested.id, buttonLabels: row.buttons.map((button) => button.label), detail: `中央線差=${(Math.max(...centerYs) - Math.min(...centerYs)).toFixed(2)}px` }] : []),
              ...(overflowButtons.length > 0 || rootOverflow ? [{ check: "overflow", scope: requested.id, buttonLabels: overflowButtons.length > 0 ? overflowButtons.map((button) => button.label) : row.buttons.map((button) => button.label), detail: overflowButtons.length > 0 ? `scope境界外=${overflowButtons.map((button) => button.label).join(",")}` : `scrollWidth-clientWidth=${root.scrollWidth - root.clientWidth}px` }] : []),
            ],
          };
        });
        results.push({ id: `${requested.id}#${rootIndex + 1}`, selector: requested.selector, required: Boolean(requested.required), matched: 1, buttonCount: controls.filter((control) => ["button", "summary"].includes(control.tagName)).length, controlCount: controls.length, rows, violations: rows.flatMap((row) => row.violations) });
      });
    }
    return results;
  }, { requestedScopes: scopes, geometryTolerance: tolerance });
}

export function assertButtonLayoutAudit(results, options = {}) {
  const exceptions = normalizeExceptions(options.exceptions ?? []);
  const requiredMissing = results.filter((result) => result.required && result.matched === 0).map((result) => `${result.id} (${result.selector})`);
  const violations = results.flatMap((result) => result.violations).filter((issue) => !exceptions.some((exception) => exceptionApplies(issue, exception)));
  assert.deepEqual(requiredMissing, [], `必須ボタンscopeが見つかりません: ${requiredMissing.join(", ")}`);
  assert.deepEqual(violations, [], `ボタン配置監査に失敗しました: ${JSON.stringify(violations)}`);
  return { results, exceptionsApplied: exceptions.filter((exception) => results.some((result) => result.violations.some((issue) => exceptionApplies(issue, exception)))) };
}

export async function assertButtonLayoutHelperSelfTest(page) {
  await page.setContent(`<!doctype html><style>
    .fixture { display: flex; align-items: center; gap: 4px; width: 320px; }
    .fixture button, .fixture select { box-sizing: border-box; height: 30px; }
    .fixture-height button:first-child { height: 42px; }
    .fixture-offset button:last-child { transform: translateY(8px); }
  </style>
  <div class="fixture fixture-good"><button>正常1</button><button>正常2</button></div>
  <div class="fixture fixture-height"><button>高さ違い</button><button>高さ標準</button></div>
  <div class="fixture fixture-offset"><button>位置標準</button><button>位置ずれ</button></div>`);
  const good = await collectButtonLayoutAudit(page, [{ id: "fixture-good", selector: ".fixture-good", required: true }]);
  assertButtonLayoutAudit(good);
  const height = await collectButtonLayoutAudit(page, [{ id: "fixture-height", selector: ".fixture-height", required: true }]);
  assert.throws(() => assertButtonLayoutAudit(height), /height/);
  const offset = await collectButtonLayoutAudit(page, [{ id: "fixture-offset", selector: ".fixture-offset", required: true }]);
  assert.throws(() => assertButtonLayoutAudit(offset), /alignment/);
}
