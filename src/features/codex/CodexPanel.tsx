import { useEffect, useId, useRef, useState, type ChangeEvent } from "react";
import { loadSettings, saveSettings } from "../../lib/commands";
import { replaceImageOccurrenceSource } from "../../lib/assetConversion";
import { cancelCodex, generateCodex, listCodexLogs, setCodexLogLimit } from "./api";
import { CodexConversationHistory } from "./CodexConversationHistory";
import { CodexImageEdit } from "./CodexImageEdit";
import { CodexLogViewer } from "./CodexLogViewer";
import { CodexProposalReview } from "./CodexProposalReview";
import "./codex.css";
import { diagramInstruction, validateDiagramForAdoption, type CodexDiagramKind } from "./diagram";
import { loadTranscriptionImage, transcriptionImages } from "./imageTranscription";
import { canApplyProposal, DEFAULT_CODEX_OPTIONS, normalizeCodexOptions, requestBytes, type CodexLogData, type EditorSnapshot } from "./model";
import { CodexMarkdownPreview, diagramImage } from "./preview";
import { DEFAULT_CODEX_SESSION_RETENTION_DAYS, deleteCodexSession, loadCodexSessions, setCodexSessionRetention, upsertCodexSession, type CodexConversation, type CodexConversationAttachment } from "./sessions";
import { scopeRequest, type CodexEditMode, type CodexTarget } from "./scope";
import { useCodexSkills } from "./skills";
type Proposal = {
    base: EditorSnapshot;
    original: string;
    value: string;
};
const iso = () => new Date().toISOString();
function fresh(documentId: string, documentPath: string, title: string): CodexConversation {
    const time = iso();
    return { id: crypto.randomUUID(), title: title || "無題の会話", documentId, documentPath, messages: [], attachments: [], nextTextTargetNumber: 1, draft: { instruction: "", targetSnapshot: null, editMode: "document", attachmentIds: [] }, createdAt: time, updatedAt: time, lastMessageAt: null };
}
function withTextTarget(value: CodexConversation, snapshot: EditorSnapshot): CodexConversation {
    const number = value.nextTextTargetNumber ?? 1;
    return { ...value, nextTextTargetNumber: number + 1, updatedAt: iso(), draft: { ...value.draft, targetLabel: `対象テキスト${number}`, targetSnapshot: snapshot } };
}
function hasConversationContent(value: CodexConversation) {
    return value.messages.length > 0 || !!value.draft.instruction.trim() || !!value.draft.targetSnapshot || value.draft.attachmentIds.length > 0;
}
function selectionKey(target: CodexTarget | null | undefined, action: "add" | "new" | undefined) {
    if (!target)
        return "";
    return [target.documentId, target.from, target.to, target.imageSource ?? "", target.skillId ?? "", target.editMode ?? "", action ?? ""].join("\u0000");
}
export function CodexPanel(props: {
    open: boolean;
    onClose: () => void;
    documentName: string;
    documentText: string;
    available: boolean;
    documentPath?: string;
    baseDir?: string;
    imageTarget?: {
        documentId: string;
        offset: number;
    } | null;
    consultationTarget?: CodexTarget | null;
    stagedImages?: Record<string, string>;
    getSnapshot: () => EditorSnapshot | null;
    applyProposal: (base: EditorSnapshot, replacement: string) => boolean;
    applyProposalAsync?: (base: EditorSnapshot, replacement: string) => Promise<boolean>;
    diagramKind?: CodexDiagramKind;
    renderProposal?: (replacement: string) => React.ReactNode;
    initialSkillId?: string;
    initialConversationAction?: "add" | "new";
    renderedSvg?: string;
}) {
    const { open, onClose, documentName, documentText, available, documentPath = "", baseDir = "", consultationTarget: suppliedTarget, stagedImages = {}, getSnapshot, applyProposal, applyProposalAsync, diagramKind, renderProposal, initialSkillId, initialConversationAction, renderedSvg } = props;
    const current = getSnapshot();
    const modelsId = useId();
    const [ignoredTarget, setIgnoredTarget] = useState<CodexTarget | null>(null);
    const selected: CodexTarget | null | undefined = suppliedTarget ? (ignoredTarget === suppliedTarget ? null : suppliedTarget) : (diagramKind && initialSkillId && current ? { ...current, from: 0, to: current.content.length, targetKind: diagramKind, skillId: initialSkillId, conversationAction: initialConversationAction } : null);
    const [options, setOptions] = useState(DEFAULT_CODEX_OPTIONS);
    const [savedOptions, setSavedOptions] = useState(DEFAULT_CODEX_OPTIONS);
    const [ready, setReady] = useState(false);
    const [saving, setSaving] = useState(false);
    const initial = useRef(fresh("", "", documentName));
    const [conversation, setConversation] = useState(initial.current);
    const conversationRef = useRef(initial.current);
    const conversationId = useRef(initial.current.id);
    const [sessions, setSessions] = useState<CodexConversation[]>([]);
    const [retention, setRetention] = useState(DEFAULT_CODEX_SESSION_RETENTION_DAYS);
    const [sessionsReady, setSessionsReady] = useState(false);
    const sessionsLoaded = useRef(false);
    const [logs, setLogs] = useState<CodexLogData>({ entries: [], limit: 20 });
    const [historyOpen, setHistoryOpen] = useState(false);
    const [logsOpen, setLogsOpen] = useState(false);
    const [proposal, setProposal] = useState<Proposal | null>(null);
    const [busy, setBusy] = useState(false);
    const [imageBusy, setImageBusy] = useState(false);
    const [applying, setApplying] = useState(false);
    const applyingRef = useRef(false);
    const [width, setWidth] = useState(420);
    const [chatRatio, setChatRatio] = useState(45);
    const body = useRef<HTMLDivElement>(null);
    const chat = useRef<HTMLDivElement>(null);
    const [preparingImage, setPreparingImage] = useState(false);
    const [selectedImageId, setSelectedImageId] = useState<string>();
    const [error, setError] = useState("");
    const active = useRef<string | null>(null);
    const mounted = useRef(false);
    const saveTimer = useRef<number | undefined>(undefined);
    const saveQueue = useRef(Promise.resolve());
    const knownSessionIds = useRef(new Set<string>());
    const input = useRef<HTMLTextAreaElement | null>(null);
    const fileInput = useRef<HTMLInputElement | null>(null);
    const targetKey = useRef("");
    const skills = useCodexSkills();
    const selectedSkill = skills.find((skill) => skill.id === (selected?.skillId ?? initialSkillId));
    const effectiveDiagramKind: CodexDiagramKind | undefined = diagramKind ?? (selected?.targetKind === "mermaid" || selected?.targetKind === "drawio" || selected?.targetKind === "svg" ? selected.targetKind : undefined);
    const incomingKey = selectionKey(selected, selected?.conversationAction ?? initialConversationAction);
    const imageEditAction = !!selected?.imageSource && !effectiveDiagramKind && selectedSkill?.config.mode === "selection";
    const mode: CodexEditMode = conversation.draft.editMode;
    const settingsDirty = JSON.stringify(options) !== JSON.stringify(savedOptions);
    const replaceConversation = (next: CodexConversation) => { conversationRef.current = next; conversationId.current = next.id; setConversation(next); };
    const updateConversation = (change: (value: CodexConversation) => CodexConversation) => { const next = change(conversationRef.current); replaceConversation(next); return next; };
    const saveConversation = (value: CodexConversation, immediate = false) => {
        if (!sessionsReady || (!hasConversationContent(value) && !knownSessionIds.current.has(value.id)))
            return;
        knownSessionIds.current.add(value.id);
        const work = () => {
            saveQueue.current = saveQueue.current.then(async () => {
                const store = await upsertCodexSession(value);
                if (mounted.current) {
                    setSessions(store.sessions);
                    setRetention(store.retentionDays);
                }
            }).catch(() => { if (mounted.current)
                setError("会話履歴を保存できません。"); });
        };
        if (saveTimer.current)
            clearTimeout(saveTimer.current);
        if (immediate)
            work();
        else
            saveTimer.current = window.setTimeout(work, 300);
    };
    const stop = () => { const id = active.current; active.current = null; setBusy(false); if (id)
        void cancelCodex(id).catch(() => { }); };
    const newConversation = () => {
        stop(); saveConversation(conversationRef.current, true);
        setIgnoredTarget(suppliedTarget ?? null); setSelectedImageId(undefined); setProposal(null);
        replaceConversation(fresh(current?.documentId ?? "", documentPath, documentName));
    };
    async function deleteConversation(id: string) {
        if (saveTimer.current) clearTimeout(saveTimer.current);
        await saveQueue.current;
        const store = await deleteCodexSession(id);
        knownSessionIds.current.delete(id);
        setSessions(store.sessions);
        if (conversationRef.current.id === id) {
            stop(); setIgnoredTarget(suppliedTarget ?? null); setSelectedImageId(undefined); setProposal(null);
            replaceConversation(fresh(current?.documentId ?? "", documentPath, documentName));
        }
    }
    useEffect(() => { if (chat.current) chat.current.scrollTop = chat.current.scrollHeight; }, [conversation.messages.length, busy]);
    useEffect(() => { saveConversation(conversation); }, [conversation]);
    useEffect(() => {
        mounted.current = true;
        let stopped = false;
        void Promise.all([loadSettings().catch((): Record<string, unknown> => ({})), loadCodexSessions().catch(() => ({ sessions: [], retentionDays: DEFAULT_CODEX_SESSION_RETENTION_DAYS })), listCodexLogs().catch(() => ({ entries: [], limit: 20 }))]).then(([settings, store, log]) => {
            if (stopped)
                return;
            const value = normalizeCodexOptions(settings.codex);
            setOptions(value);
            setSavedOptions(value);
            setSessions(store.sessions);
            store.sessions.forEach(item => knownSessionIds.current.add(item.id));
            setRetention(store.retentionDays);
            setLogs(log);
            sessionsLoaded.current = true;
            setReady(true);
            setSessionsReady(true);
        });
        return () => { stopped = true; mounted.current = false; if (saveTimer.current)
            clearTimeout(saveTimer.current); if (sessionsLoaded.current && (hasConversationContent(conversationRef.current) || knownSessionIds.current.has(conversationRef.current.id)))
            saveQueue.current = saveQueue.current.then(() => upsertCodexSession(conversationRef.current)).then(() => {}).catch(() => { }); stop(); };
    }, []);
    useEffect(() => {
        if (!sessionsReady)
            return;
        const snapshot = getSnapshot();
        const previous = documentPath ? sessions.filter((item) => item.documentPath === documentPath).sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0] : undefined;
        if (previous && previous.id !== conversationId.current) {
            const compatible = !previous.draft.targetSnapshot || previous.draft.targetSnapshot.content === snapshot?.content;
            replaceConversation({ ...previous, documentId: snapshot?.documentId ?? previous.documentId, draft: { ...previous.draft, targetSnapshot: compatible && previous.draft.targetSnapshot && snapshot ? { ...previous.draft.targetSnapshot, documentId: snapshot.documentId } : null } });
        }
        else if (!previous && conversationRef.current.documentPath !== documentPath)
            replaceConversation(fresh(snapshot?.documentId ?? "", documentPath, documentName));
    }, [documentName, documentPath, sessionsReady]);
    useEffect(() => { if (open && savedOptions.enabled)
        input.current?.focus(); }, [open, savedOptions.enabled]);
    useEffect(() => {
        if (!sessionsReady || (selected?.skillId && !selectedSkill))
            return;
        const action = selected?.conversationAction ?? initialConversationAction;
        const key = selectionKey(selected, action);
        if (!key || targetKey.current === key || !selected)
            return;
        targetKey.current = key;
        if (busy)
            stop();
        const resumed = action === "add" && !documentPath ? [...sessions].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0] : undefined;
        if (action === "new") saveConversation(conversationRef.current, true);
        const base = action === "new" ? fresh(selected.documentId, documentPath, documentName) : resumed ?? conversationRef.current;
        const labeled = selected.imageSource || selectedSkill?.config.inputs.includes("text") === false ? base : withTextTarget(base, { documentId: selected.documentId, content: selected.content, from: selected.from, to: selected.to });
        replaceConversation({ ...labeled, updatedAt: iso(), draft: { ...labeled.draft, instruction: base.draft.instruction || (imageEditAction ? "" : selectedSkill?.prompt || "対象について説明してください。"), editMode: selected.editMode ?? selectedSkill?.config.mode ?? (selected.imageSource ? "question" : base.draft.editMode) } });
    }, [documentName, documentPath, initialConversationAction, selected, selectedSkill?.config.mode, sessions, sessionsReady]);
    async function addImage(source: string, loaded?: {
        base64: string;
        mime: string;
        name: string;
    }) {
        try {
            const owner = conversationRef.current.id;
            const raw = selected ? selected.content.slice(selected.from, selected.to) : documentText;
            const code = raw.replace(/^\s*(?:`{3,}|~{3,})[^\n]*\n/, "").replace(/\n(?:`{3,}|~{3,})\s*$/, "");
            const image = loaded ?? await (effectiveDiagramKind && !selected?.imageSource ? diagramImage(diagramKind ? documentText : code, effectiveDiagramKind, selected?.renderedSvg ?? renderedSvg) : loadTranscriptionImage(documentPath, stagedImages[source] ?? source));
            if (!mounted.current || conversationRef.current.id !== owner) return null;
            const prior = conversationRef.current.attachments.find((item) => item.base64 === image.base64);
            if (prior)
                return prior.id;
            const mime = "mime" in image && typeof image.mime === "string" ? image.mime : "image/png";
            const item: CodexConversationAttachment = { id: crypto.randomUUID(), label: `添付ファイル${conversationRef.current.attachments.length + 1}`, base64: image.base64, mime, name: loaded?.name ?? source, addedAt: iso() };
            replaceConversation({ ...conversationRef.current, attachments: [...conversationRef.current.attachments, item], updatedAt: iso() });
            return item.id;
        }
        catch (cause) {
            setError(String(cause));
            return null;
        }
    }
    async function addSelectedImage() {
        if (!selected?.imageSource)
            return;
        const id = await addImage(selected.imageSource);
        if (id)
            updateConversation((value) => ({ ...value, updatedAt: iso(), draft: { ...value.draft, attachmentIds: [...new Set([...value.draft.attachmentIds, id])] } }));
    }
    useEffect(() => {
        if (!sessionsReady || !selected || (!selected.imageSource && !(effectiveDiagramKind && selectedSkill?.config.inputs.includes("image")))) return;
        let cancelled = false;
        const owner = conversationRef.current.id;
        setPreparingImage(true);
        void addImage(selected.imageSource ?? `diagram:${effectiveDiagramKind}`).then(id => {
            if (id && !cancelled && conversationRef.current.id === owner) { setSelectedImageId(id); updateConversation(value => ({ ...value, draft: { ...value.draft, attachmentIds: [...new Set([...value.draft.attachmentIds, id])] } })); }
        }).finally(() => { if (!cancelled) setPreparingImage(false); });
        return () => { cancelled = true; };
    }, [sessionsReady, incomingKey, selectedSkill?.id]);
    async function addFile(event: ChangeEvent<HTMLInputElement>) {
        const owner = conversationRef.current.id;
        const file = event.target.files?.[0];
        event.target.value = "";
        if (!file)
            return;
        if (file.size > 10 * 1024 * 1024) return setError("画像は10MB以下にしてください。");
        if (file.type !== "image/png")
            return setError("PNG画像を選択してください。");
        const base64 = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onerror = () => reject(reader.error ?? new Error("画像を読み込めません。")); reader.onload = () => resolve(String(reader.result).replace(/^data:[^;]+;base64,/, "")); reader.readAsDataURL(file); }).catch((cause) => { setError(String(cause)); return null; });
        if (!base64 || !mounted.current || conversationRef.current.id !== owner)
            return;
        const id = await addImage(`file:${file.name}:${crypto.randomUUID()}`, { base64, mime: "image/png", name: file.name });
        if (id)
            updateConversation((value) => ({ ...value, updatedAt: iso(), draft: { ...value.draft, attachmentIds: [...new Set([...value.draft.attachmentIds, id])] } }));
    }
    function captureText() {
        const snapshot = getSnapshot();
        if (!snapshot)
            return setError("編集画面を開いてから取り込んでください。");
        updateConversation((value) => {
            const next = withTextTarget(value, snapshot.from === snapshot.to ? { ...snapshot, from: 0, to: snapshot.content.length } : snapshot);
            return { ...next, draft: { ...next.draft, editMode: value.draft.editMode === "question" ? "question" : snapshot.from === snapshot.to ? "document" : "selection" } };
        });
    }
    async function send() {
        const session = conversationRef.current;
        if (imageEditAction || active.current || busy || preparingImage || applying || !savedOptions.enabled || settingsDirty || !available || !session.draft.instruction.trim()) return;
        const snapshot = getSnapshot();
        if (!snapshot) return setError("編集画面を開いてから送信してください。");
        const target = session.draft.targetSnapshot;
        if (target && (target.documentId !== snapshot.documentId || !canApplyProposal(snapshot, target))) return setError("対象本文が変わりました。取り込み直してください。");
        if (session.lastMessageAt && Date.now() - Date.parse(session.lastMessageAt) > 60 * 60 * 1000 && !window.confirm("最終会話から1時間以上経過しています。キャッシュを利用できない可能性があり、入力の再処理による利用量・コストが増える場合があります。続けて送信しますか？")) return;
        const id = crypto.randomUUID(), sessionId = session.id;
        active.current = id; setBusy(true); setError(""); setProposal(null);
        try {
            const ids = [...session.draft.attachmentIds];
            if (active.current !== id || conversationRef.current.id !== sessionId || !mounted.current) return;
            const requested = session.draft.instruction.trim();
            const prompt = selectedSkill?.prompt ?? "";
            const instructionText = prompt && !requested.startsWith(prompt) ? `${prompt}\n\n追加指示: ${requested}` : requested;
            const scoped = scopeRequest(snapshot, target, mode, instructionText);
            const historicalIds = session.messages.flatMap(message => message.attachmentIds);
            const attachments = conversationRef.current.attachments.filter(item => ids.includes(item.id) || historicalIds.includes(item.id));
            if (selectedSkill?.config.inputs.includes("image") && !attachments.length) throw new Error("このスキルには画像が必要です。画像を追加してください。");
            const labels = attachments.map((item, index) => `${index + 1}枚目=${item.label}`).join("、");
            const text = selectedSkill?.config.inputs.includes("text") === false || (!target && mode === "question") ? "" : scoped.text;
            const targetLabel = target ? session.draft.targetLabel ?? "対象テキスト1" : `対象テキスト${session.nextTextTargetNumber ?? 1}`;
            const instruction = `${scoped.instruction}${text ? target ? `\n今回の${targetLabel}: 文字位置${target.from}〜${target.to}。${mode === "document" ? "入力本文は文書全体です。" : "入力本文がこの対象です。"}` : `\n入力本文全体を${targetLabel}として参照してください。` : ""}${!diagramKind && effectiveDiagramKind && /^\s*(?:`{3,}|~{3,})/.test(scoped.text) ? "\n対象はMarkdownの図コードブロックです。replacementには元と同じ言語のコードフェンスを含む対象全体を返してください。" : ""}${labels ? `\n\n添付画像の順序: ${labels}\n今回の添付: ${ids.map(imageId => attachments.find(item => item.id === imageId)?.label).join("、") || "なし（過去の添付は履歴の参照用です）"}` : ""}`;
            const history = session.messages.map(({ role, text: message, attachmentIds }) => ({ role, text: message + (attachmentIds.length ? `\n添付: ${attachmentIds.map(imageId => session.attachments.find(item => item.id === imageId)?.label ?? "画像データなし").join("、")}` : "") }));
            if (history.length > 40 || requestBytes(instruction, text, history) > 120000) throw new Error("送信量が上限を超えています。新しい会話を開始してください。");
            const user = { role: "user" as const, text: requested + (text ? `\n\n${mode === "document" && target ? `文書全体（${targetLabel}は文字位置${target.from}〜${target.to}）` : targetLabel}:\n${text}` : ""), attachmentIds: ids, timestamp: iso() };
            const reply = await generateCodex({ id, instruction: diagramKind ? diagramInstruction(diagramKind, instruction) : instruction, text, history, ...(attachments.length ? { images: attachments.map(item => ({ base64: item.base64 })) } : {}) });
            if (!mounted.current || active.current !== id || conversationId.current !== sessionId) return;
            const time = iso();
            updateConversation(value => value.id !== sessionId ? value : { ...value, nextTextTargetNumber: !target && text ? (session.nextTextTargetNumber ?? 1) + 1 : value.nextTextTargetNumber, messages: [...value.messages, user, { role: "assistant", text: reply.answer + (reply.replacement === null ? "" : `\n\n変更案:\n${reply.replacement}`), attachmentIds: [], timestamp: time }], draft: { ...value.draft, instruction: "", attachmentIds: [], targetSnapshot: null, targetLabel: undefined, editMode: "question" }, lastMessageAt: time, updatedAt: time, contextTokens: reply.inputTokens ?? value.contextTokens });
            setSelectedImageId(undefined); setIgnoredTarget(suppliedTarget ?? null);
            if (mode !== "question" && reply.replacement !== null) setProposal({ base: scoped.base, original: scoped.text, value: reply.replacement });
            void listCodexLogs().then(setLogs).catch(() => {});
        } catch (cause) { if (mounted.current && active.current === id) setError(String(cause)); }
        finally { if (active.current === id) { active.current = null; setBusy(false); } }
    }
    async function accept(value: string) {
        if (!proposal || applyingRef.current)
            return;
        applyingRef.current = true;
        setApplying(true);
        try {
            if (diagramKind)
                await validateDiagramForAdoption(diagramKind, value);
            if (!canApplyProposal(getSnapshot(), proposal.base))
                throw new Error("生成後に本文や文書が変わりました。最新の本文で生成し直してください。");
            const accepted = applyProposalAsync ? await applyProposalAsync(proposal.base, value) : applyProposal(proposal.base, value);
            if (!accepted)
                throw new Error("生成後に本文や文書が変わりました。最新の本文で生成し直してください。");
            setProposal(null);
        }
        catch (cause) {
            setError(String(cause));
        }
        finally {
            applyingRef.current = false;
            setApplying(false);
        }
    }
    const editing = selected?.imageSource ? conversation.attachments.find((item) => item.id === selectedImageId) : undefined;
    const textTarget = conversation.draft.targetSnapshot;
    return <aside hidden={!open} className="codex-panel" style={{ "--codex-panel-width": `${width}px` } as React.CSSProperties} aria-label="Codex文章アシスタント" onKeyDown={event => {
        if (event.key !== "Escape") return;
        event.preventDefault(); event.stopPropagation();
        if (applyingRef.current) return;
        if (proposal) setProposal(null); else if (historyOpen) setHistoryOpen(false); else if (logsOpen) setLogsOpen(false); else { stop(); onClose(); }
    }}>
    <div className="codex-panel__resize" role="separator" tabIndex={0} aria-label="Codexパネルの幅を変更" aria-orientation="vertical" aria-valuemin={300} aria-valuemax={760} aria-valuenow={width}
      onPointerDown={event => { event.preventDefault(); event.currentTarget.focus(); event.currentTarget.setPointerCapture?.(event.pointerId); }}
      onPointerMove={event => { if (event.buttons === 1) setWidth(Math.max(300, Math.min(760, window.innerWidth - event.clientX))); }}
      onKeyDown={event => { if (event.key === "ArrowLeft" || event.key === "ArrowRight") { event.preventDefault(); setWidth(value => Math.max(300, Math.min(760, value + (event.key === "ArrowLeft" ? 20 : -20)))); } }} />
    <header inert={!!proposal || historyOpen || logsOpen}><button type="button" onClick={newConversation}>新しい会話を開始</button><div><button type="button" onClick={() => { if (busy)
        stop(); setHistoryOpen(true); }}>会話履歴（{sessions.length}）</button><button type="button" onClick={() => void listCodexLogs().then((data) => { setLogs(data); setLogsOpen(true); }).catch((cause) => setError(String(cause)))}>通信記録（{logs.entries.length}）</button><button type="button" onClick={onClose} aria-label="Codexパネルを閉じる">×</button></div></header>
    <div ref={body} className="codex-panel__body" inert={!!proposal || historyOpen || logsOpen} style={{ "--codex-chat-ratio": `${chatRatio}%` } as React.CSSProperties}>
      <section className="codex-panel__conversation">
        <h2>会話ログ</h2>
        <div ref={chat} className="codex-panel__chat" role="log" aria-label="会話ログ" aria-busy={busy}>
          {conversation.messages.length === 0 && <p className="codex-panel__empty">ここに会話が表示されます。</p>}
          {conversation.messages.map((message, index) => <section className={`codex-message codex-message--${message.role}`} key={`${message.timestamp}-${index}`}>
            <strong>{message.role === "user" ? "あなた" : "Codex"}</strong><pre>{message.text}</pre>
            {message.attachmentIds.map(id => { const attachment = conversation.attachments.find(item => item.id === id); return attachment ? <button key={id} type="button" className="codex-message__image" onClick={() => { saveConversation(conversationRef.current, true); setSessions(current => [conversationRef.current, ...current.filter(item => item.id !== conversationRef.current.id)]); setHistoryOpen(true); }}><img src={`data:${attachment.mime};base64,${attachment.base64}`} alt={`${attachment.label}のサムネイル`} />{attachment.label}</button> : <small key={id}>画像データなし</small>; })}
          </section>)}
        </div>
      </section>
      <div className="codex-panel__chat-resize" role="separator" tabIndex={0} aria-label="会話ログと指示文の高さを変更" aria-orientation="horizontal" aria-valuemin={20} aria-valuemax={75} aria-valuenow={chatRatio}
        onPointerDown={event => { event.preventDefault(); event.currentTarget.focus(); event.currentTarget.setPointerCapture?.(event.pointerId); }}
        onPointerMove={event => { if (event.buttons !== 1 || !event.currentTarget.hasPointerCapture?.(event.pointerId)) return; const bounds = body.current?.getBoundingClientRect(); if (bounds?.height) setChatRatio(Math.max(20, Math.min(75, (event.clientY - bounds.top) / bounds.height * 100))); }}
        onKeyDown={event => { if (event.key === "ArrowUp" || event.key === "ArrowDown" || event.key === "Home" || event.key === "End") { event.preventDefault(); setChatRatio(value => event.key === "Home" ? 20 : event.key === "End" ? 75 : Math.max(20, Math.min(75, value + (event.key === "ArrowUp" ? -5 : 5)))); } }} />
      <section className="codex-panel__composer" aria-label="次回送信する内容">
        {busy && <div className="codex-panel__sending" role="status"><span className="codex-panel__spinner" aria-hidden="true" />送信中・Codexの回答を待っています…</div>}
        {!imageEditAction && <div className="codex-panel__prompt">
          <label>指示文<textarea aria-label="指示" ref={input} value={conversation.draft.instruction} rows={7} disabled={busy || applying || !savedOptions.enabled}
            placeholder="例: 添付ファイル1を見ながら、対象テキスト1について説明してください。"
            onChange={event => updateConversation(value => ({ ...value, updatedAt: iso(), draft: { ...value.draft, instruction: event.target.value } }))}
            onKeyDown={event => { if (!event.nativeEvent.isComposing && event.key === "Enter" && (event.ctrlKey || event.metaKey)) { event.preventDefault(); void send(); } }} />
          </label>
          <div className="codex-panel__send-actions"><button type="button" aria-label="送信（Ctrl+Enter）" disabled={!savedOptions.enabled || busy || preparingImage || applying || !available || !conversation.draft.instruction.trim() || settingsDirty} onClick={() => void send()}>{busy ? "送信中…" : "送信"}<small>（Ctrl+Enter）</small></button><button type="button" disabled={!busy} onClick={stop}>停止</button></div>
        </div>}
        {editing && !effectiveDiagramKind && selectedSkill?.config.mode === "selection" && editing.mime === "image/png" && <CodexImageEdit documentPath={documentPath} source={selected!.imageSource!} originalBase64={editing.base64} disabled={!savedOptions.enabled || settingsDirty || !ready} initialInstruction={`${selectedSkill.prompt}\n今回の画像は${editing.label}です。`} instruction={conversation.draft.instruction} onBusyChange={setImageBusy} onGenerated={instruction => {
            const time = iso();
            updateConversation(value => ({ ...value, messages: [...value.messages, { role: "user", text: instruction, attachmentIds: [editing.id], timestamp: time }, { role: "assistant", text: "画像を生成しました。変更前後を確認して採用できます。", attachmentIds: [], timestamp: time }], draft: { ...value.draft, instruction: "", attachmentIds: [], targetSnapshot: null, targetLabel: undefined }, lastMessageAt: time, updatedAt: time }));
        }} onInstructionChange={instruction => updateConversation(value => ({ ...value, updatedAt: iso(), draft: { ...value.draft, instruction } }))} onReferenceChange={async (source, replacement) => {
            const snapshot = getSnapshot();
            if (!snapshot || !selected || !canApplyProposal(snapshot, selected)) return false;
            const occurrence = transcriptionImages(snapshot.content).find(item => item.source === source && item.start >= selected.from && item.end <= selected.to);
            if (!occurrence) return false;
            const changed = replaceImageOccurrenceSource(snapshot.content, occurrence, replacement);
            return applyProposal({ ...snapshot, from: 0, to: snapshot.content.length }, changed);
        }}/>}
        <fieldset className="codex-panel__tool" disabled={!ready || busy || imageBusy || saving}>
          <label>ツール<select aria-label="ツール" value="codex-cli" onChange={() => {}}><option value="codex-cli">Codex CLI</option></select></label>
          <label>モデル<input list={modelsId} value={options.model} onChange={event => setOptions({ ...options, model: event.target.value })}/><datalist id={modelsId}>{[...new Set([savedOptions.model, DEFAULT_CODEX_OPTIONS.model, "gpt-5.6-terra", "gpt-6-astra"])].map(model => <option key={model} value={model} />)}</datalist></label>
          <div className="codex-panel__tool-actions"><label><input type="checkbox" checked={options.enabled} onChange={event => setOptions({ ...options, enabled: event.target.checked })}/>Codex CLIを有効にする</label>
            {settingsDirty && <button type="button" onClick={() => void (async () => { setSaving(true); try { const value = normalizeCodexOptions(options); await saveSettings({ codex: value }); setSavedOptions(value); } catch (cause) { setError(String(cause)); } finally { setSaving(false); } })()}>設定を保存</button>}
          </div>
        </fieldset>
        <section className="codex-panel__scope" aria-label="今回の対象" inert={imageBusy || !sessionsReady}>
          <strong>次回送信する対象・添付</strong>
          <div className="codex-panel__actions">
            <button type="button" disabled={busy} onClick={captureText}>対象テキストを取り込む</button>
            <button type="button" disabled={busy || preparingImage} onClick={() => fileInput.current?.click()}>画像ファイルを追加</button>
            <input ref={fileInput} className="codex-panel__file-input" hidden type="file" accept="image/png" aria-label="添付するPNG画像" onChange={event => void addFile(event)}/>
            {selected?.imageSource && <button type="button" disabled={busy} onClick={() => void addSelectedImage()}>現在の画像を追加</button>}
          </div>
          {textTarget && <div className="codex-panel__text-target"><strong>{conversation.draft.targetLabel ?? "対象テキスト1"}</strong><small>{textTarget.content.slice(textTarget.from, textTarget.to)}</small><button type="button" disabled={busy} onClick={() => updateConversation(value => ({ ...value, updatedAt: iso(), draft: { ...value.draft, targetSnapshot: null, targetLabel: undefined, editMode: value.draft.editMode === "selection" ? "question" : value.draft.editMode } }))}>対象テキストを外す</button></div>}
          {conversation.draft.attachmentIds.length > 0 && <ul aria-label="添付画像">{conversation.draft.attachmentIds.map(id => { const attachment = conversation.attachments.find(item => item.id === id); return attachment && <li key={id}><img src={`data:${attachment.mime};base64,${attachment.base64}`} alt={`${attachment.label}のサムネイル`}/><strong>{attachment.label}</strong><small>{attachment.name}</small><button type="button" disabled={busy} onClick={() => { updateConversation(value => ({ ...value, updatedAt: iso(), draft: { ...value.draft, attachmentIds: value.draft.attachmentIds.filter(valueId => valueId !== id) } })); if (selectedImageId === id) setSelectedImageId(undefined); }}>対象から外す</button></li>; })}</ul>}
          {!textTarget && conversation.draft.attachmentIds.length === 0 && <p>対象・添付は未登録です。</p>}
          <small>送信が成功した対象は会話ログに残り、ここから外れます。</small>
        </section>
        <label>編集の許可<select aria-label="編集の許可" disabled={busy} value={mode === "selection" && !textTarget ? "document" : mode} onChange={event => updateConversation(value => ({ ...value, updatedAt: iso(), draft: { ...value.draft, editMode: event.target.value as CodexEditMode } }))}><option value="question">質問のみ</option>{textTarget && (textTarget.from > 0 || textTarget.to < textTarget.content.length) && <option value="selection">指定場所のみ編集</option>}{textTarget && mode === "selection" && textTarget.from === 0 && textTarget.to === textTarget.content.length && <option value="selection">指定場所のみ編集</option>}<option value="document">{textTarget && (textTarget.from > 0 || textTarget.to < textTarget.content.length) ? "指定場所以外の編集を認める" : "文書全体を編集"}</option></select></label>
        {mode === "document" && <small>文書全体を送信して編集を依頼します。</small>}
        {preparingImage && <p role="status">画像を準備しています…</p>}
        {error && !proposal && <p role="alert">{error}</p>}
      </section>
    </div>
    {proposal && <div className="codex-proposal-preview" role="dialog" aria-modal="true" aria-label="Codex変更案のプレビュー"><CodexProposalReview original={proposal.original} value={proposal.value} onChange={(value) => setProposal((old) => old ? { ...old, value } : null)} renderPreview={diagramKind ? (value) => renderProposal?.(value) : (value) => <CodexMarkdownPreview source={value} baseDir={baseDir}/>} validate={diagramKind ? async (value) => { await validateDiagramForAdoption(diagramKind, value); } : undefined} onAccept={accept} onReject={() => setProposal(null)} onClose={() => setProposal(null)} busy={applying} error={error}/></div>}
    {historyOpen && <CodexConversationHistory sessions={sessions} selectedId={conversation.id} retentionDays={retention} onDelete={deleteConversation} onClose={() => setHistoryOpen(false)} onSelect={(id) => { const item = sessions.find((value) => value.id === id); if (item) {
        stop();
        saveConversation(conversationRef.current, true);
        setIgnoredTarget(suppliedTarget ?? null); setProposal(null); setSelectedImageId(undefined);
        const snapshot = getSnapshot();
        replaceConversation(item.documentPath === documentPath && item.draft.targetSnapshot && snapshot && item.draft.targetSnapshot.content === snapshot.content ? { ...item, draft: { ...item.draft, targetSnapshot: { ...item.draft.targetSnapshot, documentId: snapshot.documentId } } } : item);
    } setHistoryOpen(false); }} onRetentionChange={(days) => { void setCodexSessionRetention(days).then((store) => { setSessions(store.sessions); setRetention(store.retentionDays); void listCodexLogs().then(setLogs).catch(() => {}); const cutoff = Date.now() - days * 86400000; if (days === 0 || Date.parse(conversationRef.current.updatedAt) < cutoff) replaceConversation(fresh(current?.documentId ?? "", documentPath, documentName)); }).catch((cause) => setError(String(cause))); }}/>}
    {logsOpen && <CodexLogViewer data={logs} onClose={() => setLogsOpen(false)} onLimitChange={async (limit) => { setLogs(await setCodexLogLimit(limit)); }}/>}
  </aside>;
}
