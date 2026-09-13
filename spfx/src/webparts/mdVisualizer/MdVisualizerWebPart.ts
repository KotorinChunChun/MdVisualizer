import { Version } from '@microsoft/sp-core-library';
import {
  PropertyPaneDropdown,
  PropertyPaneTextField,
  type IPropertyPaneConfiguration
} from '@microsoft/sp-property-pane';
import { SPHttpClient } from '@microsoft/sp-http';
import { BaseClientSideWebPart } from '@microsoft/sp-webpart-base';
import type { IReadonlyTheme } from '@microsoft/sp-component-base';
import { resolveDrawioConnection, type DrawioConnectionMode } from './DrawioConnection';
import { MdVisualizerController, type EditorViewMode } from './MdVisualizerController';
import { SharePointMarkdownFileBrowser, type ISharePointMarkdownFile } from './SharePointMarkdownFileBrowser';
import { SharePointMarkdownRepository, type IMarkdownFileSnapshot } from './SharePointMarkdownRepository';
import './MdVisualizer.global.scss';

export interface IMdVisualizerWebPartProps {
  sourceWebUrl?: string;
  documentLibrary?: string;
  subfolderPath?: string;
  serverRelativeFileUrl?: string;
  drawioConnectionMode?: DrawioConnectionMode;
  drawioEditorUrl?: string;
  drawioViewerUrl?: string;
  drawioSharePointPageUrl?: string;
}

export default class MdVisualizerWebPart extends BaseClientSideWebPart<IMdVisualizerWebPartProps> {
  private _editor?: MdVisualizerController;
  private _repository?: SharePointMarkdownRepository;
  private _snapshot?: IMarkdownFileSnapshot;
  private _files: ISharePointMarkdownFile[] = [];
  private _dirty = false;
  private _generation = 0;

  public render(): void {
    this._generation += 1;
    const generation = this._generation;
    this._editor?.dispose();
    this.domElement.innerHTML = '';

    const root = document.createElement('section');
    root.className = 'spfxMdVisualizer';
    const commands = document.createElement('div');
    commands.className = 'spfxMarkdownCommandBar';
    const refresh = this._button('ファイル一覧', () => { void this._loadFileChoices(generation); });
    const select = document.createElement('select');
    select.setAttribute('aria-label', 'Markdownファイル');
    select.append(new Option('Markdownファイルを選択してください', ''));
    select.addEventListener('change', () => {
      if (select.value) void this._selectFile(select.value, generation);
    });
    const modes: EditorViewMode[] = ['edit', 'split', 'preview'];
    const labels: Record<EditorViewMode, string> = { edit: '編集のみ', split: '編集／閲覧', preview: '閲覧のみ' };
    modes.forEach(mode => {
      const button = this._button(labels[mode], () => {
        this._editor?.setMode(mode);
        commands.querySelectorAll<HTMLButtonElement>('[data-view-mode]').forEach(item => item.setAttribute('aria-pressed', String(item.dataset.viewMode === mode)));
      });
      button.dataset.viewMode = mode;
      button.setAttribute('aria-pressed', String(mode === 'split'));
      commands.appendChild(button);
    });
    commands.prepend(refresh, select);
    const status = document.createElement('p');
    status.className = 'spfxMarkdownStatus';
    status.setAttribute('role', 'status');
    status.textContent = 'ファイル一覧を読み込んでください。';
    const editorHost = document.createElement('div');
    editorHost.className = 'spfxMdVisualizerHost';
    root.append(commands, status, editorHost);
    this.domElement.appendChild(root);

    try {
      const connection = resolveDrawioConnection({
        mode: this.properties.drawioConnectionMode,
        editorUrl: this.properties.drawioEditorUrl,
        viewerUrl: this.properties.drawioViewerUrl,
        sharePointPageUrl: this.properties.drawioSharePointPageUrl
      }, this._webUrl);
      this._editor = new MdVisualizerController({
        root: editorHost,
        drawioConnection: connection,
        onChanged: () => { this._dirty = true; status.textContent = '未保存の変更があります。'; },
        onSave: () => { void this._saveFile(generation); },
        onExportAsset: (source, base) => this._readExportAsset(source, base)
      });
    } catch (error) {
      status.textContent = `draw.io設定エラー: ${this._message(error)}`;
      return;
    }

    if (this.properties.serverRelativeFileUrl) {
      void this._selectFile(this.properties.serverRelativeFileUrl, generation);
    } else {
      void this._loadFileChoices(generation);
    }
  }

  protected onDispose(): void {
    this._generation += 1;
    this._editor?.dispose();
    this._editor = undefined;
  }

  protected onThemeChanged(currentTheme: IReadonlyTheme | undefined): void {
    if (!currentTheme) return;
    const semanticColors = currentTheme.semanticColors;
    if (!semanticColors) return;
    this.domElement.style.setProperty('--bodyText', semanticColors.bodyText || '');
    this.domElement.style.setProperty('--bodyBackground', semanticColors.bodyBackground || '');
  }

  protected get dataVersion(): Version { return Version.parse('1.0'); }

  protected getPropertyPaneConfiguration(): IPropertyPaneConfiguration {
    return {
      pages: [{
        header: { description: 'MdVisualizer接続設定' },
        groups: [{
          groupName: 'SharePoint',
          groupFields: [
            PropertyPaneTextField('sourceWebUrl', { label: 'SharePointサイトURL（空欄は現在のサイト）' }),
            PropertyPaneTextField('documentLibrary', { label: '文書ライブラリ（空欄はすべて）' }),
            PropertyPaneTextField('subfolderPath', { label: 'サブフォルダー' }),
            PropertyPaneDropdown('drawioConnectionMode', {
              label: 'draw.io接続',
              options: [
                { key: 'official', text: '公式diagrams.net' },
                { key: 'selfHosted', text: '自社ホスト' },
                { key: 'tenantSite', text: '指定SharePointサイト' },
                { key: 'disabled', text: '無効' }
              ]
            }),
            PropertyPaneTextField('drawioEditorUrl', { label: '自社draw.io Editor URL' }),
            PropertyPaneTextField('drawioViewerUrl', { label: '自社draw.io Viewer URL' }),
            PropertyPaneTextField('drawioSharePointPageUrl', { label: 'SharePoint draw.ioページURL' })
          ]
        }]
      }]
    };
  }

  private get _webUrl(): string {
    return (this.properties.sourceWebUrl || this.context.pageContext.web.absoluteUrl).replace(/\/$/, '');
  }

  private async _loadFileChoices(generation: number): Promise<void> {
    const status = this._status;
    status.textContent = 'Markdownファイルを検索しています…';
    try {
      const browser = new SharePointMarkdownFileBrowser(this.context.spHttpClient, SPHttpClient.configurations.v1, this._webUrl);
      const files = await browser.list(this.properties.documentLibrary || '', this.properties.subfolderPath || '');
      if (generation !== this._generation) return;
      this._files = files;
      const select = this.domElement.querySelector<HTMLSelectElement>('select');
      if (!select) return;
      select.innerHTML = '';
      select.append(new Option(files.length ? 'Markdownファイルを選択してください' : 'Markdownファイルがありません', ''));
      files.forEach(file => select.append(new Option(`${file.libraryTitle} / ${file.relativeFilePath}`, file.serverRelativeUrl)));
      status.textContent = `${files.length}件のMarkdownファイルが見つかりました。`;
    } catch (error) {
      status.textContent = `ファイル一覧を取得できませんでした: ${this._message(error)}`;
    }
  }

  private async _selectFile(path: string, generation: number): Promise<void> {
    if (this._dirty && !window.confirm('未保存の変更を破棄して別のファイルを開きますか？')) return;
    const status = this._status;
    status.textContent = 'Markdownを読み込んでいます…';
    try {
      const repository = new SharePointMarkdownRepository(this.context.spHttpClient, SPHttpClient.configurations.v1, this._webUrl, path);
      const snapshot = await repository.load();
      if (generation !== this._generation) return;
      this._repository = repository;
      this._snapshot = snapshot;
      this._dirty = false;
      this.properties.serverRelativeFileUrl = path;
      this._editor?.setDocumentPath(path);
      this._editor?.setValue(snapshot.content);
      const selected = this._files.find(file => file.serverRelativeUrl === path);
      status.textContent = `${selected?.name || path} を読み込みました（${snapshot.format.encoding}${snapshot.format.bom ? '・BOMあり' : ''}）。`;
    } catch (error) {
      status.textContent = `Markdownを読み込めませんでした: ${this._message(error)}`;
    }
  }

  private async _saveFile(generation: number): Promise<void> {
    if (!this._repository || !this._snapshot || !this._editor) {
      this._status.textContent = '保存するMarkdownファイルを選択してください。';
      return;
    }
    this._status.textContent = '保存しています…';
    try {
      const snapshot = await this._repository.save(this._editor.value, this._snapshot);
      if (generation !== this._generation) return;
      this._snapshot = snapshot;
      this._dirty = false;
      this._status.textContent = 'SharePointへ保存しました。';
    } catch (error) {
      this._status.textContent = `保存できませんでした: ${this._message(error)}`;
    }
  }

  private async _readExportAsset(source: string, base = this.properties.serverRelativeFileUrl || ''): Promise<{ base: string; mime: string; text?: string; data: string }> {
    if (/^data:/i.test(source)) {
      const comma = source.indexOf(',');
      if (comma < 0) throw new Error('Data URLが不正です。');
      const header = source.slice(5, comma);
      const mime = (header.split(';', 1)[0] || 'text/plain').toLowerCase();
      return { base, mime, text: this._dataUriText(source, header, mime), data: source };
    }
    const resolved = new URL(source, new URL(base || '/', window.location.origin));
    if (resolved.origin !== window.location.origin) throw new Error('HTML出力では同一SharePointサイト内の資産だけを取り込めます。');
    const path = decodeURIComponent(resolved.pathname);
    const endpoint = `${this._webUrl}/_api/web/GetFileByServerRelativePath(decodedUrl='${path.replace(/'/g, "''")}')/$value`;
    const response = await this.context.spHttpClient.get(endpoint, SPHttpClient.configurations.v1, { headers: { Accept: 'application/octet-stream' } });
    if (!response.ok) throw new Error(`参照資産を読み込めません: HTTP ${response.status}`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    let binary = '';
    for (let index = 0; index < bytes.length; index += 0x8000) {
      const chunk = bytes.subarray(index, Math.min(index + 0x8000, bytes.length));
      for (let offset = 0; offset < chunk.length; offset += 1) binary += String.fromCharCode(chunk[offset]);
    }
    const responseMime = response.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase();
    const mime = !responseMime || responseMime === 'application/octet-stream' ? this._mimeForPath(path) : responseMime;
    return { base: path, mime, text: this._isTextualMime(mime) ? this._decodeText(bytes) : undefined, data: `data:${mime};base64,${btoa(binary)}` };
  }

  private _mimeForPath(path: string): string {
    const extension = path.split('.').pop()?.toLowerCase();
    return extension === 'png' ? 'image/png' : extension === 'jpg' || extension === 'jpeg' ? 'image/jpeg' : extension === 'gif' ? 'image/gif' : extension === 'svg' ? 'image/svg+xml' : extension === 'webp' ? 'image/webp' : extension === 'bmp' ? 'image/bmp' : extension === 'avif' ? 'image/avif' : extension === 'ico' ? 'image/x-icon' : extension === 'csv' ? 'text/csv' : extension === 'tsv' ? 'text/tab-separated-values' : extension === 'mmd' || extension === 'mermaid' ? 'text/plain' : extension === 'drawio' ? 'application/vnd.jgraph.mxfile' : extension === 'json' ? 'application/json' : extension === 'xml' ? 'application/xml' : 'application/octet-stream';
  }

  private _isTextualMime(mime: string): boolean {
    return mime === 'image/svg+xml' || mime.startsWith('text/') || /(?:json|xml|jgraph)/i.test(mime);
  }

  private _decodeText(bytes: Uint8Array): string {
    if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes.subarray(2));
    if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(bytes.subarray(2));
    return new TextDecoder('utf-8').decode(bytes).replace(/^\uFEFF/, '');
  }

  private _dataUriText(source: string, header: string, mime: string): string | undefined {
    if (!this._isTextualMime(mime)) return undefined;
    const payload = source.slice(source.indexOf(',') + 1);
    try {
      if (/(?:^|;)base64(?:;|$)/i.test(header)) {
        const binary = atob(payload);
        const bytes = new Uint8Array(binary.length);
        for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
        return this._decodeText(bytes);
      }
      return decodeURIComponent(payload);
    } catch {
      throw new Error('Data URLのテキストを復号できません。');
    }
  }

  private get _status(): HTMLElement {
    const status = this.domElement.querySelector<HTMLElement>('.spfxMarkdownStatus');
    if (!status) throw new Error('状態表示領域がありません。');
    return status;
  }

  private _button(label: string, action: () => void): HTMLButtonElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = label;
    button.addEventListener('click', action);
    return button;
  }

  private _message(error: unknown): string { return error instanceof Error ? error.message : String(error); }
}
