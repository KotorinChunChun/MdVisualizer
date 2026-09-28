// 実ファイル・設定・資格情報に接続しない、試作専用ホスト。
import samples from 'preview-samples';
const root='C:/UI-Preview/';
const assets=new Map<string, any>();
const normalize=(path:string)=>path.replaceAll('\\','/');
function assetPath(documentPath:string,source:string){
  const value=normalize(source);
  if(/^[a-z]+:/i.test(value)&&!value.startsWith(root))throw new Error('試作外の参照です。');
  const joined=value.startsWith(root)?value:normalize(documentPath).slice(0,normalize(documentPath).lastIndexOf('/')+1)+value;
  const parts:string[]=[];
  for(const part of joined.split('/')){if(part==='..')parts.pop();else if(part!=='.')parts.push(part);}
  const path=parts.join('/');if(!path.startsWith(root))throw new Error('試作外の参照です。');return path;
}
export const fixturePath = 'C:/UI-Preview/プロジェクトノート.md';
const content = '# プロジェクトノート\n\nチームで文書を育てるワークスペース。\n\n## 今週の予定\n\n- 要件の整理\n- UIの確認\n- レビューの共有\n\n## 進捗\n\n| 作業 | 状態 |\n| --- | --- |\n| 要件整理 | 完了 |\n| UI統合 | 確認中 |\n\n## コード\n\n```typescript\nconst message = "Hello";\n```\n';
const documentFixture = { path: fixturePath, kind: 'markdown', content, base_dir: 'C:/UI-Preview', image_paths: [], encoding: 'UTF-8', size_bytes: new TextEncoder().encode(content).length, modified_at: '2026-09-29 00:00:00', revision: 'preview-1', source: 'local' };
const documents = new Map<string, typeof documentFixture>([[fixturePath, documentFixture]]);
let revision = 1;
let customCss: string | undefined;
const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value));
function getDocument(path: string) {
  const value = documents.get(path);
  if (!value) throw new Error('この試作内に保存された文書がありません。');
  return copy(value);
}
function storeDocument(path: string, text: string) {
  if (!path.startsWith('C:/UI-Preview/') || path.slice(14).includes('..')) throw new Error('試作内の文書名だけ指定できます。');
  const value = { ...documentFixture, ...documents.get(path), path, base_dir:path.slice(0,path.lastIndexOf('/')), content: text, size_bytes: new TextEncoder().encode(text).length, revision: `preview-${++revision}`, modified_at: new Date().toLocaleString('ja-JP') };
  documents.set(path, value); return copy(value);
}
storeDocument('C:/UI-Preview/表とコード.md', '# 表とコード\n\n## 表\n\n| 名前 | 状態 |\n| --- | --- |\n| 機能A | 確認中 |\n| 機能B | 完了 |\n\n## コード\n\n```javascript\nconsole.log("共通UI");\n```\n');
for(const sample of samples){
  const path=root+'samples/'+sample.name;
  assets.set(path,{...sample,path,filename:sample.name.split('/').pop(),revision:'sample-1',source:'local',canEdit:false,editDisabledReason:'外部参照ファイルの更新は試作では未接続です。'});
  if(/\.(md|tsv|svg|mmd|drawio)$/.test(sample.name)){
    const doc=storeDocument(path,sample.text);
    doc.kind=({tsv:'tsv',svg:'svg',mmd:'mermaid',drawio:'drawio'} as Record<string,string>)[sample.name.split('.').pop()!]??'markdown';
    documents.set(path,doc);
  }
}
const params = new URLSearchParams(location.search);
const themes = ['system', 'light', 'dark', 'github', 'solarized', 'nord'];
const zooms = [50,60,70,80,90,100,110,120,130,140,150,160,170,180,190,200];
let settings: Record<string, unknown> = { theme: themes.includes(params.get('theme') ?? '') ? params.get('theme') : 'light', externalApps: [], documentViewModes: {}, zoom: zooms.includes(Number(params.get('zoom'))) ? Number(params.get('zoom')) : 100 };
export const requests: string[] = [];
export async function invoke<T>(command: string, args: any = {}): Promise<T> {
  requests.push(command);
  let result: unknown;
  switch (command) {
    case 'get_initial_files': result = [documents.has(root+'samples/'+params.get('sample'))?root+'samples/'+params.get('sample'):fixturePath]; break;
    case 'read_document_asset': {const asset=assets.get(assetPath(args.documentPath,args.source));if(!asset)throw new Error('同梱されていない参照ファイルです。');result=copy(asset);break;}
    case 'read_image_for_edit': {const asset=assets.get(normalize(args.path));if(!asset)throw new Error('同梱画像がありません。');result=`data:${asset.mediaType};base64,${asset.base64}`;break;}
    case 'load_markdown': result = getDocument(args.path); break;
    case 'save_markdown': {
      const request = args.request;
      const current = getDocument(request.path);
      result = current.revision !== request.expectedRevision ? { status: 'conflict', latest: current } : { status: 'saved', document: storeDocument(request.path, request.content) };
      break;
    }
    case 'create_markdown': {
      if (documents.has(args.request.path)) throw new Error('同名文書があります。別の名前を指定してください。');
      result = storeDocument(args.request.path, args.request.content); break;
    }
    case 'rename_document': {
      const {sourcePath,targetPath}=args.request;
      if (documents.has(targetPath)) throw new Error('同名文書があります。');
      result=storeDocument(targetPath,getDocument(sourcePath).content);documents.delete(sourcePath);break;
    }
    case 'load_settings': result = settings; break;
    case 'load_settings_status': result = { settings, recoveredFiles: [] }; break;
    case 'save_settings': settings = { ...settings, ...args.updates }; result = settings; break;
    case 'load_markdown_style': result = { css: customCss ?? args.defaultCss, path: '', revision: `preview-css-${revision}` }; break;
    case 'save_markdown_style': customCss=args.css;revision++;result={css:customCss,path:'',revision:`preview-css-${revision}`};break;
    case 'save_fold_state': settings={...settings,foldStates:{...(settings.foldStates as object ?? {}),[args.documentPath]:args.state}};result=settings;break;
    case 'update_external_app_settings': settings={...settings,externalApps:args.upserts,presentationLineThreshold:args.presentationLineThreshold,imageA4TargetWidth:args.imageA4TargetWidth,imageEqualPadding:args.imageEqualPadding};result=settings;break;
    case 'document_watch_targets': result = [args.path]; break;
    case 'diagnose_document': result = []; break;
    case 'has_image_backup': result = false; break;
    case 'sync_watch_targets': case 'remove_window_watch_targets': case 'report_debug_window_state': case 'discard_staged_assets': result = undefined; break;
    default: throw new Error(`外見試作：${command} は接続していません。実ファイル・外部サービスは変更しません。`);
  }
  return result as T;
}
export const convertFileSrc = (path: string) => {const asset=assets.get(normalize(path));return asset?`data:${asset.mediaType};base64,${asset.base64}`:'data:,';};
export const listen = async (..._args: any[]) => () => {};
const windowMock = { label: 'ui-preview', setTitle: async () => {}, listen, onCloseRequested: listen, onDragDropEvent: listen, isFullscreen: async () => false, setFullscreen: async () => {}, close: async () => {}, destroy: async () => {} };
export const getCurrentWindow = () => windowMock;
export const getCurrentWebview = () => windowMock;
export const getCurrentWebviewWindow = () => windowMock;
function chooseDocument(mode: 'open'|'save', options: any = {}): Promise<string | null> {
  return new Promise(resolve => {
    const dialog=document.createElement('dialog'); dialog.setAttribute('aria-label',mode==='open'?'試作内の文書を開く':'試作内に名前を付けて保存');
    dialog.style.cssText='margin:auto;padding:24px;min-width:300px;max-width:90vw;color:var(--text-primary);background:var(--panel-bg);border:1px solid var(--border-color);border-radius:8px';
    const heading=document.createElement('h2');heading.textContent=mode==='open'?'試作内の文書を開く':'試作内に名前を付けて保存';
    const note=document.createElement('p');note.textContent='メモリー内だけで保存します。ページを再読み込みすると初期状態に戻ります。';note.style.cssText='max-width:420px;margin:12px 0';
    const input=mode==='open'?document.createElement('select'):document.createElement('input');input.setAttribute('aria-label','文書名');
    if(input instanceof HTMLSelectElement){for(const path of documents.keys())input.add(new Option(path.split('/').pop(),path));}
    else input.value=String(options.defaultPath ?? '新しい文書.md').split(/[\\/]/).pop()!;
    const error=document.createElement('p');error.setAttribute('role','alert');
    const ok=document.createElement('button');ok.textContent=mode==='open'?'開く':'保存';ok.style.margin='12px';
    const cancel=document.createElement('button');cancel.textContent='キャンセル';
    let finished=false;const finish=(path:string|null)=>{if(finished)return;finished=true;dialog.close();dialog.remove();resolve(path);};
    ok.onclick=()=>{if(mode==='open'){finish(input.value);return;}const name=input.value.trim();if(!name||/[\\/:*?"<>|]/.test(name)||name.includes('..')){error.textContent='フォルダーを含まない文書名を指定してください。';return;}if(!/\.md$/i.test(name)){error.textContent='この試作では .md 文書に保存できます。';return;}finish(`C:/UI-Preview/${name}`);};
    cancel.onclick=()=>finish(null);dialog.oncancel=e=>{e.preventDefault();finish(null);};
    dialog.append(heading,note,input,error,ok,cancel);document.body.append(dialog);dialog.showModal();input.focus();
  });
}
export const open = async (options:any={}) => {const path=await chooseDocument('open',options);return path && options.multiple ? [path] : path;};
export const save = async (options:any={}) => chooseDocument('save',options);
(globalThis as any).__previewRequests = requests;
