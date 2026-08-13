import type { IResolvedDrawioConnection } from './DrawioConnection';

export interface IDrawioMessage {
  event?: string;
  xml?: string;
  exit?: boolean;
}

export function parseTrustedDrawioMessage(
  event: Pick<MessageEvent, 'source' | 'origin' | 'data'>,
  source: MessageEventSource | null,
  origin: string
): IDrawioMessage | undefined {
  if (!source || event.source !== source || event.origin !== origin) return undefined;
  try {
    const value = typeof event.data === 'string' ? JSON.parse(event.data) : event.data;
    return value && typeof value === 'object' ? value as IDrawioMessage : undefined;
  } catch {
    return undefined;
  }
}

export class DrawioEditorBridge {
  private _overlay?: HTMLElement;
  private _frame?: HTMLIFrameElement;
  private _source = '';

  public constructor(
    private readonly _connection: IResolvedDrawioConnection,
    private readonly _onSave: (source: string) => void
  ) {}

  public open(source: string): void {
    if (!this._connection.enabled || !this._connection.editorUrl) throw new Error('draw.io接続が無効です。');
    if (this._connection.mode === 'official' && !window.confirm('図データを公式diagrams.netへ送信して編集します。続行しますか？')) return;
    this.close();
    this._source = source.trim() || '<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/></root></mxGraphModel>';
    const overlay = document.createElement('div');
    overlay.className = 'spfxMarkdownDrawioOverlay';
    const header = document.createElement('header');
    header.innerHTML = '<strong>draw.io図の編集</strong>';
    const close = document.createElement('button');
    close.type = 'button';
    close.textContent = '閉じる';
    close.addEventListener('click', () => this.close());
    header.appendChild(close);
    const frame = document.createElement('iframe');
    frame.src = this._connection.editorUrl.toString();
    frame.title = 'draw.io editor';
    frame.referrerPolicy = 'no-referrer';
    frame.setAttribute('allow', 'clipboard-read; clipboard-write');
    overlay.append(header, frame);
    document.body.appendChild(overlay);
    this._overlay = overlay;
    this._frame = frame;
    window.addEventListener('message', this._receive);
  }

  public close(): void {
    window.removeEventListener('message', this._receive);
    this._overlay?.remove();
    this._overlay = undefined;
    this._frame = undefined;
  }

  public dispose(): void { this.close(); }

  private readonly _receive = (event: MessageEvent): void => {
    const origin = this._connection.editorUrl?.origin;
    if (!origin) return;
    const message = parseTrustedDrawioMessage(event, this._frame?.contentWindow || null, origin);
    if (!message) return;
    if (message.event === 'init') {
      this._frame?.contentWindow?.postMessage(JSON.stringify({
        action: 'load',
        xml: this._source,
        title: 'Markdown diagram',
        noSaveBtn: 1,
        saveAndExit: 1,
        fit: 1
      }), origin);
    } else if (message.event === 'save' && typeof message.xml === 'string' && message.xml.length <= 20 * 1024 * 1024) {
      this._onSave(message.xml.trim());
      if (message.exit) this.close();
    } else if (message.event === 'exit') {
      this.close();
    }
  };
}
