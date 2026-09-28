// 実ファイル・設定・資格情報に接続しない、試作専用ホスト。
export const fixturePath = 'C:/UI-Preview/プロジェクトノート.md';
const content = '# プロジェクトノート\n\nチームで文書を育てるワークスペース。\n\n## 今週の予定\n\n- 要件の整理\n- UIの確認\n- レビューの共有\n\n## 進捗\n\n| 作業 | 状態 |\n| --- | --- |\n| 要件整理 | 完了 |\n| UI統合 | 確認中 |\n\n## コード\n\n```typescript\nconst message = "Hello";\n```\n';
const documentFixture = { path: fixturePath, kind: 'markdown', content, base_dir: 'C:/UI-Preview', image_paths: [], encoding: 'UTF-8', size_bytes: new TextEncoder().encode(content).length, modified_at: '2026-09-29 00:00:00', revision: 'preview-1', source: 'local' };
const params = new URLSearchParams(location.search);
const themes = ['system', 'light', 'dark', 'github', 'solarized', 'nord'];
const zooms = [50,60,70,80,90,100,110,120,130,140,150,160,170,180,190,200];
let settings: Record<string, unknown> = { theme: themes.includes(params.get('theme') ?? '') ? params.get('theme') : 'light', externalApps: [], documentViewModes: {}, zoom: zooms.includes(Number(params.get('zoom'))) ? Number(params.get('zoom')) : 100 };
export const requests: string[] = [];
export async function invoke<T>(command: string, args: any = {}): Promise<T> {
  requests.push(command);
  let result: unknown;
  switch (command) {
    case 'get_initial_files': result = [fixturePath]; break;
    case 'load_markdown': result = { ...documentFixture }; break;
    case 'load_settings': result = settings; break;
    case 'load_settings_status': result = { settings, recoveredFiles: [] }; break;
    case 'save_settings': settings = { ...settings, ...args.updates }; result = settings; break;
    case 'load_markdown_style': result = { css: args.defaultCss, path: '', revision: 'preview' }; break;
    case 'save_fold_state': result = {}; break;
    case 'diagnose_document': result = []; break;
    case 'has_image_backup': result = false; break;
    case 'sync_watch_targets': case 'remove_window_watch_targets': case 'report_debug_window_state': case 'discard_staged_assets': result = undefined; break;
    default: throw new Error(`外見試作：${command} は接続していません。実ファイル・外部サービスは変更しません。`);
  }
  return result as T;
}
export const convertFileSrc = (_path: string) => 'data:,';
export const listen = async (..._args: any[]) => () => {};
const windowMock = { label: 'ui-preview', setTitle: async () => {}, listen, onCloseRequested: listen, onDragDropEvent: listen, isFullscreen: async () => false, setFullscreen: async () => {}, close: async () => {}, destroy: async () => {} };
export const getCurrentWindow = () => windowMock;
export const getCurrentWebview = () => windowMock;
export const getCurrentWebviewWindow = () => windowMock;
export const open = async () => null;
export const save = async () => null;
(globalThis as any).__previewRequests = requests;
