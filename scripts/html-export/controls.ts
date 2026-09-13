export const outputControlsCss = `
.export-code-block{position:relative;margin:1em 0;border-radius:6px;overflow:hidden;min-width:0}
.export-code-block>pre{margin:0!important;border:0!important;border-radius:0!important;padding-top:6px!important}
.export-code-header{display:flex;align-items:center;gap:8px;padding:8px 12px 2px;min-width:0}
.export-code-language{font:11px/1.5 system-ui,sans-serif;opacity:.65;overflow-wrap:anywhere;min-width:0;margin-right:auto}
.export-actions{display:flex;gap:5px;flex-shrink:0}.export-action{display:none;font:11px/1.5 system-ui,sans-serif;padding:3px 7px;background:transparent;color:inherit;border:1px solid #8886;border-radius:4px;cursor:pointer}
.export-interactive .export-action{display:inline-block}.export-action:focus-visible{outline:2px solid currentColor;outline-offset:2px}
.export-wrap pre,.export-wrap pre *{white-space:pre-wrap!important;overflow-wrap:anywhere!important;word-break:normal!important}
.export-table-block{margin:1em 0;min-width:0}.export-table-block>.export-actions{justify-content:flex-end;margin-bottom:4px}
.export-table-block.export-wrap table{table-layout:fixed;width:100%}.export-table-block.export-wrap td,.export-table-block.export-wrap th{white-space:normal!important;overflow-wrap:anywhere!important}
.export-status{font:11px/1.5 system-ui,sans-serif;min-height:0}.export-status:empty{display:none}
.export-toc{position:fixed;top:12px;right:12px;z-index:5;width:fit-content;max-width:calc(100vw - 24px);margin:0 0 16px;border:1px solid #8886;border-radius:6px;background:inherit;font-size:12px}
.export-toc nav>.export-actions{margin-bottom:8px}.export-toc summary{cursor:pointer;padding:6px 12px}.export-toc nav{max-height:50vh;overflow:auto;padding:0 16px 10px}.export-toc a{display:block;padding:3px 0;color:inherit;text-decoration:none}.export-toc a:hover{text-decoration:underline}
[hidden]{display:none!important}
.export-toast{position:fixed;bottom:24px;left:50%;transform:translateX(-50%);z-index:30;max-width:calc(100vw - 32px);padding:10px 18px;border-radius:6px;background:#24292f;color:#fff;font:14px/1.5 system-ui,sans-serif;box-shadow:0 4px 20px #0003;pointer-events:none}
.export-table-filter{min-width:100px;width:190px;max-width:100%;padding:5px 8px;border:1px solid #8886;border-radius:4px;background:transparent;color:inherit;font:12px system-ui,sans-serif}.export-table-count{font:11px system-ui,sans-serif;align-self:center;margin-right:auto}.export-table-block>.export-actions{flex-wrap:wrap}.export-table-block th button{margin-left:6px}
.export-fold-body{min-width:0}h2>.export-action,h3>.export-action,h4>.export-action,h5>.export-action,h6>.export-action{border:0;padding:0 5px 0 0;font-size:.7em}
.export-zoomable{cursor:zoom-in}.export-zoomable:focus-visible{outline:2px solid currentColor}
.export-zoom{position:fixed;inset:0;margin:auto;width:92vw;max-width:92vw;max-height:92vh;padding:16px;border:1px solid #8886;border-radius:8px}.export-zoom::backdrop{background:#0009}.export-zoom>.export-actions{align-items:center;justify-content:flex-end;flex-wrap:wrap;margin-bottom:10px}.export-zoom-viewport{overflow:auto;max-height:75vh}.export-zoom-viewport img{display:block;max-width:none;height:auto;margin:auto}.export-zoom-size{font-size:12px}
@media(max-width:600px){.export-code-header{flex-wrap:wrap}.export-actions{margin-left:auto}}
@media print{.export-actions,.export-action,.export-toast,.export-toc,.export-zoom{display:none!important}.export-fold-body[hidden],.export-table-block tr[hidden]{display:block!important}.export-table-block tr[hidden]{display:table-row!important}}
`;

export { outputControlsScript } from './runtime';

export function addOutputControls(host: HTMLElement, metadata: Map<HTMLElement, string>, interactive: boolean, totals: Set<HTMLTableRowElement>) {
  function actions(block: HTMLElement, table: boolean) {
    const tools = document.createElement('div'); tools.className = 'export-actions';
    for (const [action, label] of [['wrap', '折り返し'], ['copy', 'コピー']]) {
      const button = document.createElement('button'); button.type = 'button'; button.className = 'export-action';
      button.dataset.exportAction = action; button.textContent = label;
      button.setAttribute('aria-label', `${table ? '表' : 'コード'}を${label}`);
      if (action === 'wrap') button.setAttribute('aria-pressed', 'false');
      tools.append(button);
    }
    return tools;
  }
  for (const [pre, labelText] of metadata) {
    const block = document.createElement('section'); block.className = 'export-code-block';
    block.style.backgroundColor = pre.style.backgroundColor;
    pre.replaceWith(block);
    const header = document.createElement('div'); header.className = 'export-code-header';
    const label = document.createElement('span'); label.className = 'export-code-language'; label.textContent = labelText || 'text';
    header.append(label); block.append(header, pre);
    if (interactive) header.append(actions(block, false));
  }
  if (!interactive) return;
  for (const row of totals) row.dataset.exportTotal = 'true';
  for (const table of host.querySelectorAll<HTMLElement>('.table-scroll')) {
    const block = document.createElement('section'); block.className = 'export-table-block'; table.replaceWith(block);
    block.append(actions(block, true), table);
  }
  const headings = [...host.querySelectorAll<HTMLElement>('h1,h2,h3,h4,h5,h6')];
  if (headings.length) {
    const toc = document.createElement('details'); toc.className = 'export-toc'; toc.style.backgroundColor = document.body.style.backgroundColor; toc.style.color = document.body.style.color;
    const summary = document.createElement('summary'); summary.textContent = '目次';
    const nav = document.createElement('nav'); nav.setAttribute('aria-label', '目次');
    for (const heading of headings) {
      const link = document.createElement('a'); link.href = '#' + encodeURIComponent(heading.id); link.textContent = heading.textContent;
      link.style.paddingLeft = `${(Number(heading.tagName[1]) - 1) * 10}px`; nav.append(link);
    }
    toc.append(summary, nav); host.prepend(toc);
  }
}
