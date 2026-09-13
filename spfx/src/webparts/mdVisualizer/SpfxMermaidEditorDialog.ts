import { mermaidEditorDocument } from '../../generated/embeddedTools';

export function openSpfxMermaidEditor(source: string, onApply: (source: string) => void): void {
  const nonce = crypto.randomUUID();
  const overlay = document.createElement('div');
  overlay.className = 'spfxMermaidEditorOverlay';
  const dialog = document.createElement('section');
  dialog.setAttribute('role', 'dialog'); dialog.setAttribute('aria-modal', 'true'); dialog.setAttribute('aria-label', 'Mermaid GUI編集');
  const header = document.createElement('header');
  const title = document.createElement('strong'); title.textContent = 'Mermaid GUI編集';
  const close = document.createElement('button'); close.type = 'button'; close.textContent = '×'; close.setAttribute('aria-label', 'Mermaid GUI編集を閉じる');
  header.append(title, close);
  const frame = document.createElement('iframe'); frame.title = 'Mermaid GUI編集'; frame.sandbox.add('allow-scripts', 'allow-same-origin', 'allow-modals', 'allow-forms'); frame.srcdoc = mermaidEditorDocument;
  const footer = document.createElement('footer');
  const cancel = document.createElement('button'); cancel.type = 'button'; cancel.textContent = 'キャンセル';
  const apply = document.createElement('button'); apply.type = 'button'; apply.className = 'primary'; apply.textContent = '反映'; apply.disabled = true;
  footer.append(cancel, apply); dialog.append(header, frame, footer); overlay.append(dialog); document.body.append(overlay);
  const dispose = (): void => { window.removeEventListener('message', onMessage); overlay.remove(); };
  const onMessage = (event: MessageEvent<unknown>): void => {
    if (event.source !== frame.contentWindow || !event.data || typeof event.data !== 'object') return;
    const data = event.data as { kind?: string; nonce?: string; source?: unknown };
    if (data.kind === 'mdvisualizer-mermaid-ready') { apply.disabled = false; frame.contentWindow?.postMessage({ kind: 'mdvisualizer-mermaid-source', nonce, source }, '*'); return; }
    if (data.kind !== 'mdvisualizer-mermaid-current-source' || data.nonce !== nonce || typeof data.source !== 'string') return;
    try { onApply(data.source); dispose(); } catch (error) { apply.disabled = false; alert(error instanceof Error ? error.message : String(error)); }
  };
  window.addEventListener('message', onMessage);
  close.addEventListener('click', dispose); cancel.addEventListener('click', dispose);
  apply.addEventListener('click', () => { apply.disabled = true; frame.contentWindow?.postMessage({ kind: 'mdvisualizer-mermaid-request-current-source', nonce }, '*'); });
}
