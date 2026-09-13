import { useEffect, useMemo, useRef, useState } from "react";
import { MarkdownEditor, type MarkdownEditorHandle } from "@/components/MarkdownEditor";
import { MarkdownPreview } from "@/components/MarkdownPreview";
import { DocumentToc } from "@/components/DocumentToc";
import { SearchBar } from "@/components/SearchBar";
import { SearchResults } from "@/components/SearchResults";
import { HtmlExportDialog, type HtmlExportDialogSubmit } from "@/components/HtmlExportDialog";
import { MediaPreviewModal, type MediaPreviewTarget } from "@/components/MediaPreviewModal";
import { exportHtmlInBrowser, downloadHtml } from "@/lib/htmlExport";
import { printWebDocument } from "./printDocument";
import { collectEditableMarkdownOccurrences, replaceCodeFenceBody, type CodeFenceOccurrence, type MarkdownTableOccurrence } from "@/lib/markdownOccurrences";
import { buildPresentationModel } from "@/lib/presentationModel";
import { useSearch } from "@/hooks/useSearch";
import { assetBase, assetMime, AssetWorkspace, resolveAssetPath } from "./workspace";
import { initialSession, importDocument, sessionZip, type DocumentSession } from "./documentSession";
import { loadDraft, saveDraft, clearDraft } from "./drafts";
import { configureBrowserBridge, replaceAsset } from "./browserBridge";
import { WebDiff, WebPresentation } from "./WebDocumentTools";
import { WebImageEditor } from "./WebImageEditor";
import { RemoteStorage as ServerStorage } from "./RemoteStorage";
import { decode, detectEncoding, encode, hasBom, type TextEncoding } from "./encoding";
import { applyImageEdit, applyInlineSvgEdit, convertSessionStorage, renameSessionAsset } from "./assetEditing";

type View = "source" | "preview" | "split";
const workspace = new AssetWorkspace();
const baseName = (name: string) => name.replace(/\.[^.]*$/, "") || "document";
const saveBlob = (blob: Blob, name: string) => { const link = document.createElement("a"); link.href = URL.createObjectURL(blob); link.download = name; link.click(); window.setTimeout(() => URL.revokeObjectURL(link.href), 500); };

export function WebApp() {
  const hosted = location.protocol !== "file:" && (location.pathname.endsWith("index.php") || Boolean((window as Window & { __MDVISUALIZER_PHP__?: boolean }).__MDVISUALIZER_PHP__));
  const [session, setSession] = useState<DocumentSession>(initialSession), [draftReady, setDraftReady] = useState(false);
  const [view, setView] = useState<View>("split"), [message, setMessage] = useState(""), [saving, setSaving] = useState(false), [diff, setDiff] = useState(false), [presentation, setPresentation] = useState(false), [baseline, setBaseline] = useState(session.markdown), [assetBaselineRevision, setAssetBaselineRevision] = useState(0), [htmlExportOpen, setHtmlExportOpen] = useState(false), [exportProgress, setExportProgress] = useState(""), [printProgress, setPrintProgress] = useState(""), [media, setMedia] = useState<MediaPreviewTarget | null>(null), [imageEditor, setImageEditor] = useState<MediaPreviewTarget | null>(null), [tocOpen, setTocOpen] = useState(false), [searchOpen, setSearchOpen] = useState(false), [imageVersions, setImageVersions] = useState<Record<string, number>>({}), [draftError, setDraftError] = useState("");
  const fileRef = useRef<HTMLInputElement>(null); const editorRef = useRef<MarkdownEditorHandle>(null); const previewRef = useRef<HTMLElement>(null); const searchInputRef = useRef<HTMLInputElement>(null); const sessionRef = useRef(session); const workspaceAssetsRef = useRef<DocumentSession["assets"] | null>(null); const baselineAssetsRef = useRef(new Map(session.assets.map(asset => [asset.path, asset.blob]))); const draftSaveBlockedRef = useRef(false); const draftTimerRef = useRef<number | null>(null); const importGenerationRef = useRef(0); const exportAbortRef = useRef<AbortController | null>(null); const exportBusyRef = useRef(false); const { name, markdown, encoding } = session;
  const search = useSearch(previewRef, "web", undefined, markdown, markdown);
  const presentationModel = useMemo(() => buildPresentationModel(markdown), [markdown]);
  const notify = (text: string) => { setMessage(text); window.setTimeout(() => setMessage(""), 4000); };
  const applySession = (next: DocumentSession) => { draftSaveBlockedRef.current = false; sessionRef.current = next; setSession(next); setBaseline(next.markdown); baselineAssetsRef.current = new Map(next.assets.map(asset => [asset.path, asset.blob])); setImageVersions({}); };
  const setMarkdown = (value: string | ((current: string) => string)) => { draftSaveBlockedRef.current = false; const current = sessionRef.current; const next = { ...current, markdown: typeof value === "function" ? value(current.markdown) : value }; sessionRef.current = next; setSession(next); };

  // Preview children resolve ZIP paths during render.  Keep their object URLs valid
  // for that render instead of replacing and revoking them from an effect afterward.
  if (workspaceAssetsRef.current !== session.assets) { workspace.replace(session.assets); workspaceAssetsRef.current = session.assets; }
  configureBrowserBridge({ workspace, documentPath: () => sessionRef.current.name, updateAsset: (path, text, blob) => { const current = sessionRef.current; const next = { ...current, assets: replaceAsset(current.assets, path, text, blob) }; draftSaveBlockedRef.current = false; sessionRef.current = next; setSession(next); setImageVersions(versions => ({ ...versions, [path]: (versions[path] ?? 0) + 1 })); } });

  useEffect(() => { document.documentElement.dataset.theme = "light"; }, []);
  useEffect(() => { sessionRef.current = session; }, [session]);
  useEffect(() => { void loadDraft().then(draft => { if (draft && confirm(`「${draft.name}」のブラウザー内下書きを復元しますか？`)) applySession(draft); setDraftReady(true); }).catch((error) => { setDraftError(error instanceof Error ? error.message : String(error)); setDraftReady(true); }); }, []);
  useEffect(() => { if (!draftReady || draftSaveBlockedRef.current) return; const timer = window.setTimeout(() => { draftTimerRef.current = null; if (!draftSaveBlockedRef.current) void saveDraft(session).catch((error) => setDraftError(error instanceof Error ? error.message : String(error))); }, 700); draftTimerRef.current = timer; return () => { window.clearTimeout(timer); if (draftTimerRef.current === timer) draftTimerRef.current = null; }; }, [draftReady, session]);

  const assetDirty = (void assetBaselineRevision, session.assets.length !== baselineAssetsRef.current.size || session.assets.some(asset => baselineAssetsRef.current.get(asset.path) !== asset.blob));
  const confirmReplaceCurrentDocument = () => {
    const current = sessionRef.current;
    const currentAssetsDirty = current.assets.length !== baselineAssetsRef.current.size || current.assets.some(asset => baselineAssetsRef.current.get(asset.path) !== asset.blob);
    return (current.markdown === baseline && !currentAssetsDirty) || window.confirm("未保存の変更があります。置き換えますか？");
  };
  const saveMarkdown = async () => { const current = sessionRef.current; setSaving(true); try { const bytes = encode(current.markdown, current.encoding, current.bom); saveBlob(new Blob([bytes], { type: "text/markdown" }), current.name); if (sessionRef.current === current) setBaseline(current.markdown); notify(`${current.encoding}で本文をダウンロードしました。ZIP資産と下書きは保持しています。`); } catch (error) { notify(error instanceof Error ? error.message : String(error)); } finally { setSaving(false); } };
  const saveZip = async () => { const current = sessionRef.current; setSaving(true); try { const archive = await sessionZip(current); saveBlob(archive, `${baseName(current.name)}.zip`); if (sessionRef.current === current) { setBaseline(current.markdown); baselineAssetsRef.current = new Map(current.assets.map(asset => [asset.path, asset.blob])); setAssetBaselineRevision(value => value + 1); } notify("本文とZIP資産を保存しました。下書きは保持しています。"); } catch (error) { notify(error instanceof Error ? error.message : String(error)); } finally { setSaving(false); } };
  const saveDocument = () => void (sessionRef.current.assets.length ? saveZip() : saveMarkdown());
  const discardDraft = async () => { draftSaveBlockedRef.current = true; if (draftTimerRef.current !== null) { window.clearTimeout(draftTimerRef.current); draftTimerRef.current = null; } try { await clearDraft(); setDraftError(""); notify("ブラウザー内の下書きを削除しました。次の編集から再保存します。"); } catch (error) { setDraftError(error instanceof Error ? error.message : String(error)); } };
  const openFile = async (file: File) => { const generation = ++importGenerationRef.current; const next = await importDocument(file); if (generation !== importGenerationRef.current) return; if (!confirmReplaceCurrentDocument()) return; applySession(next); notify(/\.zip$/i.test(file.name) ? "ZIPを読み込みました。" : `${next.encoding}で読み込みました。`); };
  const applyFence = (occurrence: CodeFenceOccurrence, source: string) => {
    const current = sessionRef.current;
    const latest = collectEditableMarkdownOccurrences(current.markdown).find(item => item.kind === "code-fence" && item.id === occurrence.id) as CodeFenceOccurrence | undefined;
    if (!latest || latest.body !== occurrence.body) { notify("対象ブロックが変更されたため反映できませんでした。"); return false; }
    try { setMarkdown(replaceCodeFenceBody(current.markdown, latest, source)); return true; } catch (error) { notify(error instanceof Error ? error.message : String(error)); return false; }
  };
  const applyTable = (occurrence: MarkdownTableOccurrence, source: string) => {
    const current = sessionRef.current;
    const latest = collectEditableMarkdownOccurrences(current.markdown).find(item => item.kind === "table" && item.id === occurrence.id) as MarkdownTableOccurrence | undefined;
    if (!latest || latest.expected !== occurrence.expected) { notify("対象の表が変更されたため反映できませんでした。"); return false; }
    setMarkdown(`${current.markdown.slice(0, latest.start)}${source}${current.markdown.slice(latest.end)}`); return true;
  };
  const saveExternalText = async (source: string, text: string) => {
    const current = sessionRef.current;
    try {
      const path = resolveAssetPath(source, assetBase(current.name));
      const original = current.assets.find(asset => asset.path === path);
      if (!original) throw new Error("ZIP内の資産を確認できません。");
      const bytes = new Uint8Array(await original.blob.arrayBuffer());
      const replacement = new Blob([encode(text, detectEncoding(bytes), hasBom(bytes))], { type: original.blob.type });
      const latest = sessionRef.current;
      const latestAsset = latest.assets.find(asset => asset.path === path);
      if (latest.name !== current.name || latestAsset?.blob !== original.blob) throw new Error("対象の資産が変更されたため保存できませんでした。");
      const next = { ...latest, assets: replaceAsset(latest.assets, path, text, replacement) };
      draftSaveBlockedRef.current = false; sessionRef.current = next; setSession(next); setImageVersions(versions => ({ ...versions, [path]: (versions[path] ?? 0) + 1 })); return true;
    } catch (error) { notify(error instanceof Error ? error.message : String(error)); return false; }
  };
  const exportHtml = async ({ mode, filename }: HtmlExportDialogSubmit) => {
    if (exportBusyRef.current) return;
    const current = sessionRef.current;
    const snapshotAssets = new AssetWorkspace();
    snapshotAssets.replace(current.assets);
    const controller = new AbortController(); exportBusyRef.current = true; exportAbortRef.current = controller; setExportProgress("資産を含むHTMLを組み立てています…");
    try {
      const result = await exportHtmlInBrowser({ markdown: current.markdown, title: baseName(current.name), theme: "light", mode, baseDir: assetBase(current.name), signal: controller.signal, onProgress: setExportProgress, readAsset: (source, base) => snapshotAssets.readAsset(source, base ?? assetBase(current.name)) });
      if (controller.signal.aborted) return;
      downloadHtml(result.html, filename.toLowerCase().endsWith(".html") ? filename : `${filename}.html`); setHtmlExportOpen(false); notify("HTMLをダウンロードしました。");
    } catch (error) { if (!controller.signal.aborted) notify(error instanceof Error ? error.message : String(error)); }
    finally { snapshotAssets.clear(); if (exportAbortRef.current === controller) exportAbortRef.current = null; exportBusyRef.current = false; setExportProgress(""); }
  };
  const cancelExport = () => exportAbortRef.current?.abort();
  const printDocument = async () => {
    if (presentation || printProgress) { if (presentation) window.print(); return; }
    const current = sessionRef.current, snapshotAssets = new AssetWorkspace();
    snapshotAssets.replace(current.assets); const controller = new AbortController(); setPrintProgress("印刷用の文書を準備しています…");
    try { await printWebDocument({ markdown: current.markdown, title: baseName(current.name), theme: "light", baseDir: assetBase(current.name), signal: controller.signal, onProgress: setPrintProgress, readAsset: (source, base) => snapshotAssets.readAsset(source, base ?? assetBase(current.name)) }); }
    catch (error) { notify(error instanceof Error ? error.message : String(error)); }
    finally { snapshotAssets.clear(); setPrintProgress(""); }
  };
  const changeEncoding = (nextEncoding: TextEncoding) => { const current = sessionRef.current; const next = { ...current, encoding: nextEncoding }; draftSaveBlockedRef.current = false; sessionRef.current = next; setSession(next); };
  const changeBom = (bom: boolean) => { const current = sessionRef.current; const next = { ...current, bom }; draftSaveBlockedRef.current = false; sessionRef.current = next; setSession(next); };
  const openLinkedDocument = async (path: string) => {
    const current = sessionRef.current;
    try {
      const target = current.assets.some(candidate => candidate.path === path) ? path : resolveAssetPath(path, assetBase(current.name));
      const asset = current.assets.find(candidate => candidate.path === target);
      if (!asset || !/\.(?:md|markdown)$/i.test(target)) throw new Error("ZIP内のMarkdownを見つけられません。");
      const bytes = new Uint8Array(await asset.blob.arrayBuffer());
      if (sessionRef.current !== current) throw new Error("編集中に文書が変更されたため開けませんでした。");
      const previous = { path: current.name, blob: new Blob([encode(current.markdown, current.encoding, current.bom)], { type: assetMime(current.name) }) };
      const assets = [...current.assets.filter(candidate => candidate.path !== target && candidate.path !== current.name), previous];
      const documentEncoding = detectEncoding(bytes);
      applySession({ name: target, markdown: decode(bytes, documentEncoding), encoding: documentEncoding, bom: hasBom(bytes), assets }); notify(`ZIP内の「${target}」を開きました。`);
    } catch (error) { notify(error instanceof Error ? error.message : String(error)); }
  };
  const jumpToLine = (line: number) => { editorRef.current?.focusLine(line); previewRef.current?.querySelector<HTMLElement>(`[data-source-line="${line}"]`)?.scrollIntoView({ block: "center" }); };
  const applyAssetTransform = async (transform: (current: DocumentSession) => DocumentSession | Promise<DocumentSession>) => {
    const current = sessionRef.current;
    try {
      const next = await transform(current);
      if (sessionRef.current !== current) throw new Error("編集中に文書が変更されたため反映できませんでした。");
      const changedPaths = new Set(next.assets.filter(asset => current.assets.find(previous => previous.path === asset.path)?.blob !== asset.blob).map(asset => asset.path));
      draftSaveBlockedRef.current = false; sessionRef.current = next; setSession(next); setImageVersions(versions => {
        const updated = { ...versions };
        changedPaths.forEach(path => { updated[path] = (updated[path] ?? 0) + 1; });
        return updated;
      }); return true;
    } catch (error) { notify(error instanceof Error ? error.message : String(error)); return false; }
  };
  const applyImage = async (target: MediaPreviewTarget, dataUri: string) => {
    const occurrence = target.conversionContext?.occurrence;
    if (!occurrence || occurrence.kind !== "image") { notify("画像の反映先が見つかりません。"); return; }
    if (await applyAssetTransform(current => applyImageEdit(current, occurrence, dataUri))) { setImageEditor(null); setMedia(null); notify("画像編集を反映しました。"); }
  };
  useEffect(() => { const onKeyDown = (event: KeyboardEvent) => { if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "p") { event.preventDefault(); void printDocument(); } }; window.addEventListener("keydown", onKeyDown); return () => window.removeEventListener("keydown", onKeyDown); });

  return <main className="web-app" onDragOver={event => event.preventDefault()} onDrop={event => { event.preventDefault(); const file = event.dataTransfer.files[0]; if (file) void openFile(file).catch(error => notify(String(error))); }}>
    <header><strong>MdVisualizer Web</strong><button type="button" onClick={() => fileRef.current?.click()}>開く</button><button type="button" onClick={saveDocument}>{session.assets.length ? "ZIPを保存" : "保存"}</button>{session.assets.length > 0 && <button type="button" onClick={() => void saveMarkdown()}>本文のみ保存</button>}<button type="button" onClick={() => setHtmlExportOpen(true)}>HTML出力</button><button type="button" onClick={() => setDiff(true)}>Diff</button><button type="button" onClick={() => setPresentation(true)}>プレゼン</button><button type="button" disabled={Boolean(printProgress)} onClick={() => void printDocument()}>{printProgress || "印刷"}</button><input ref={fileRef} type="file" accept=".md,.markdown,.zip,text/markdown" hidden onChange={event => { const file = event.target.files?.[0]; if (file) void openFile(file).catch(error => notify(String(error))); event.currentTarget.value = ""; }} /></header>
    <nav><label>表示 <select value={view} onChange={event => setView(event.target.value as View)}><option value="source">ソース</option><option value="preview">プレビュー</option><option value="split">分割</option></select></label><label>文字コード <select value={encoding} onChange={event => changeEncoding(event.target.value as TextEncoding)}>{(["UTF-8", "UTF-16LE", "UTF-16BE", "Shift_JIS"] as TextEncoding[]).map(value => <option key={value} value={value}>{value}</option>)}</select></label><label><input type="checkbox" checked={session.bom} onChange={event => changeBom(event.target.checked)} />BOM</label><button type="button" onClick={() => { setSearchOpen(open => !open); window.setTimeout(() => searchInputRef.current?.focus(), 0); }}>検索</button><button type="button" onClick={() => setTocOpen(open => !open)}>目次</button><button type="button" onClick={() => void discardDraft()}>下書きを削除</button><span>{name} / {encoding}</span></nav>
    {searchOpen && <section className="web-search"><SearchBar search={search} inputRef={searchInputRef} onClose={() => setSearchOpen(false)} /><SearchResults results={search.results} activeIndex={search.activeIndex} truncated={search.truncated} onSelect={search.setActiveIndex} onActivate={(result) => jumpToLine(result.line)} /></section>}
    <DocumentToc markdown={markdown} isOpen={tocOpen} onOpenChange={setTocOpen} onJump={(headingId) => { const line = presentationModel.pages.find(page => page.id === headingId)?.sourceLine; if (line) jumpToLine(line); setTocOpen(false); }} />
    <section className={`editor ${view}`}><div style={view === "preview" ? { display: "none" } : undefined}><MarkdownEditor ref={editorRef} documentId={`web:${name}`} value={markdown} dirty={markdown !== baseline || assetDirty} saving={saving} onChange={setMarkdown} onSave={saveDocument} onResolvePastedImage={async (image) => ({ source: `data:${image.mediaType};base64,${image.base64}` })} onPasteImageError={(error) => notify(error instanceof Error ? error.message : String(error))} compact={false} /></div><article ref={previewRef} className="markdown-body" style={view === "source" ? { display: "none" } : undefined}><MarkdownPreview content={markdown} baseDir={assetBase(name)} documentPath={name} imageVersions={imageVersions} theme="light" onError={notify} onOpenDocument={openLinkedDocument} onCodeFenceBodyChange={applyFence} onInlineSvgChange={(occurrence, svg) => { try { const current = sessionRef.current; const next = applyInlineSvgEdit(current, occurrence, svg); draftSaveBlockedRef.current = false; sessionRef.current = next; setSession(next); return true; } catch (error) { notify(error instanceof Error ? error.message : String(error)); return false; } }} onMarkdownTableChange={applyTable} onExternalTableChange={({ source, text }) => saveExternalText(source, text)} onStagedTextAssetChange={saveExternalText} onDrawioStorageConvert={context => applyAssetTransform(current => convertSessionStorage(current, context))} onMermaidStorageConvert={context => applyAssetTransform(current => convertSessionStorage(current, context))} onTableStorageConvert={context => applyAssetTransform(current => convertSessionStorage(current, context))} onTextStorageConvert={context => applyAssetTransform(current => convertSessionStorage(current, context))} onExternalFileRename={(context, filename) => applyAssetTransform(current => renameSessionAsset(current, context.source, filename))} onMediaOpen={setMedia} onTextEdit={(base, from, to, replacement) => { if (base !== sessionRef.current.markdown) return false; setMarkdown(`${base.slice(0, from)}${replacement}${base.slice(to)}`); return true; }} /></article></section>
    {htmlExportOpen && <HtmlExportDialog defaultFilename={`${baseName(name)}.html`} progress={exportProgress} running={Boolean(exportProgress)} onCancel={() => { if (exportProgress) cancelExport(); else setHtmlExportOpen(false); }} onExport={exportHtml} />}
    {media && <MediaPreviewModal content={media.content} headingTitle={media.headingTitle} diagramSource={media.diagramSource} diagramKind={media.diagramKind} conversionContext={media.conversionContext} onCrop={media.conversionContext?.occurrence.kind === "image" ? () => setImageEditor(media) : undefined} onClose={() => setMedia(null)} />}
    {imageEditor?.content.kind === "image" && <WebImageEditor source={imageEditor.content.src} filename={imageEditor.imageContext?.imagePath ?? "image.png"} onApply={(dataUri) => applyImage(imageEditor, dataUri)} onClose={() => setImageEditor(null)} onError={notify} />}
    {diff && <WebDiff session={session} baseline={baseline} onChange={setMarkdown} onSave={saveDocument} onClose={() => setDiff(false)} />}{presentation && <WebPresentation session={session} onClose={() => setPresentation(false)} onError={notify} onOpenDocument={openLinkedDocument} />}{hosted && <ServerStorage getSession={() => session} onOpen={(next) => { if (!confirmReplaceCurrentDocument()) return false; applySession(next); return true; }} notify={notify} />}{draftError && <aside className="web-draft-error" role="alert"><span>{draftError}</span><button type="button" onClick={() => void discardDraft()}>下書きを削除</button></aside>}{message && <output role="status">{message}</output>}
  </main>;
}
