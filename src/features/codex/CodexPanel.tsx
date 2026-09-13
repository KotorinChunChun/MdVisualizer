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
import { DEFAULT_CODEX_SESSION_RETENTION_DAYS, deleteCodexSession, loadCodexSessions, setCodexSessionRetention, upsertCodexSession, type CodexConversation, type CodexConversationAttachment, type CodexConversationTextTarget } from "./sessions";
import { scopeRequest, type CodexEditMode, type CodexTarget } from "./scope";
import { useCodexSkills } from "./skills";
type Proposal = {
    base: EditorSnapshot;
    original: string;
    value: string;
    /** 複数の指定場所編集では、採用時にこの範囲外が不変か再検査する。 */
    allowedRanges?: Array<{ from: number; to: number }>;
};
const iso = () => new Date().toISOString();
function fresh(documentId: string, documentPath: string, title: string): CodexConversation {
    const time = iso();
    return { id: crypto.randomUUID(), title: title || "無題の会話", documentId: documentId || undefined, documentPath, messages: [], attachments: [], nextTextTargetNumber: 1, draft: { instruction: "", targetSnapshot: null, editMode: "document", attachmentIds: [] }, createdAt: time, updatedAt: time, lastMessageAt: null };
}
function withTextTarget(value: CodexConversation, snapshot: EditorSnapshot): CodexConversation {
    const number = value.nextTextTargetNumber ?? 1;
    const item: CodexConversationTextTarget = { id: crypto.randomUUID(), label: `テキスト${number}`, snapshot, addedAt: iso() };
    return { ...value, documentId: snapshot.documentId, nextTextTargetNumber: number + 1, updatedAt: iso(), draft: { ...value.draft, targetLabel: undefined, targetSnapshot: null, textTargets: [...textTargets(value.draft), item] } };
}
function textTargets(draft: CodexConversation["draft"]): CodexConversationTextTarget[] {
    if (draft.textTargets) return draft.textTargets;
    return draft.targetSnapshot ? [{ id: "legacy-text-target", label: draft.targetLabel ?? "テキスト1", snapshot: draft.targetSnapshot, addedAt: "1970-01-01T00:00:00.000Z" }] : [];
}
function hasConversationContent(value: CodexConversation) {
    return value.messages.length > 0 || !!value.draft.instruction.trim() || textTargets(value.draft).length > 0 || value.draft.attachmentIds.length > 0;
}
export function replacementMatchesTargetRanges(original: string, replacement: string, ranges: Array<{ from: number; to: number }>) {
    const ordered = [...ranges].sort((left, right) => left.from - right.from).reduce<Array<{ from: number; to: number }>>((merged, range) => {
        const previous = merged[merged.length - 1];
        if (previous && range.from <= previous.to) previous.to = Math.max(previous.to, range.to);
        else merged.push({ ...range });
        return merged;
    }, []);
    let originalCursor = 0, replacementCursor = 0;
    for (const range of ordered) {
        if (range.from < originalCursor || range.to < range.from || range.to > original.length) return false;
        const unchanged = original.slice(originalCursor, range.from);
        if (originalCursor === 0) {
            if (!replacement.startsWith(unchanged, replacementCursor)) return false;
            replacementCursor += unchanged.length;
        } else {
            const index = replacement.indexOf(unchanged, replacementCursor);
            if (index < replacementCursor) return false;
            replacementCursor = index + unchanged.length;
        }
        originalCursor = range.to;
    }
    const suffix = original.slice(originalCursor);
    const suffixStart = replacement.length - suffix.length;
    return suffixStart >= replacementCursor && replacement.endsWith(suffix);
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
    const authorization = useRef<Promise<boolean> | null>(null);
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
            }).catch((cause) => { if (mounted.current)
                setError(`会話履歴を保存できません。${String(cause)}`); });
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
        void Promise.all([loadSettings().catch((): Record<string, unknown> => ({})), loadCodexSessions().catch(() => ({ sessions: [], retentionDays: DEFAULT_CODEX_SESSION_RETENTION_DAYS })), listCodexLogs().catch(() => ({ entries: [], limit: 20 }))]).then(async ([settings, store, log]) => {
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
            if (!stopped) { setReady(true); setSessionsReady(true); }
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
            const targets = textTargets(previous.draft);
            const compatible = targets.every(item => item.snapshot.content === snapshot?.content);
            replaceConversation({ ...previous, documentId: snapshot?.documentId ?? previous.documentId, draft: { ...previous.draft, targetSnapshot: null, targetLabel: undefined, textTargets: compatible && snapshot ? targets.map(item => ({ ...item, snapshot: { ...item.snapshot, documentId: snapshot.documentId } })) : [] } });
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
            const pending = conversationRef.current.attachments.find(item => item.base64 === image.base64 && conversationRef.current.draft.attachmentIds.includes(item.id));
            if (pending) return pending.id;
            const mime = "mime" in image && typeof image.mime === "string" ? image.mime : "image/png";
            const item: CodexConversationAttachment = { id: crypto.randomUUID(), label: `画像${conversationRef.current.attachments.length + 1}`, base64: image.base64, mime, name: loaded?.name ?? source, addedAt: iso() };
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
    async function requestAiAuthorization() {
        if (!ready || saving) return false;
        if (options.tool !== "codex-cli") {
            setError("選択したAIツールは未実装です。送信できません。");
            return false;
        }
        if (savedOptions.enabled && !settingsDirty) return true;
        if (authorization.current) return await authorization.current;
        const alreadyAuthorized = savedOptions.enabled;
        if (!alreadyAuthorized && !window.confirm("AIへの送信にはサブスクリプションのクレジットを消費します。送信を有効にしますか？")) return false;
        const work = (async () => {
            setSaving(true);
            try {
                const value = { ...options, enabled: true };
                await saveSettings({ codex: value });
                if (!mounted.current) return false;
                setOptions(value);
                setSavedOptions(value);
                return true;
            } catch (cause) {
                if (mounted.current) setError(`AI設定を保存できません。${String(cause)}`);
                return false;
            } finally {
                if (mounted.current) setSaving(false);
            }
        })();
        authorization.current = work;
        try { return await work; }
        finally { if (authorization.current === work) authorization.current = null; }
    }
    async function send() {
        const session = conversationRef.current;
        const sessionId = session.id;
        if (!ready || imageEditAction || active.current || busy || preparingImage || applying || saving || !available || !session.draft.instruction.trim()) return;
        if (!(savedOptions.enabled && !settingsDirty) && !await requestAiAuthorization()) return;
        if (!mounted.current || conversationRef.current.id !== sessionId || active.current || busy || applying) return;
        const snapshot = getSnapshot();
        if (!snapshot) return setError("編集画面を開いてから送信してください。");
        const targets = textTargets(session.draft);
        if (targets.some(item => item.snapshot.documentId !== snapshot.documentId || !canApplyProposal(snapshot, item.snapshot))) return setError("対象本文が変わりました。取り込み直してください。");
        if (session.lastMessageAt && Date.now() - Date.parse(session.lastMessageAt) > 60 * 60 * 1000 && !window.confirm("最終会話から1時間以上経過しています。キャッシュを利用できない可能性があり、入力の再処理による利用量・コストが増える場合があります。続けて送信しますか？")) return;
        const id = crypto.randomUUID();
        active.current = id; setBusy(true); setError(""); setProposal(null);
        try {
            const ids = [...session.draft.attachmentIds];
            if (active.current !== id || conversationRef.current.id !== sessionId || !mounted.current) return;
            const requested = session.draft.instruction.trim();
            const prompt = selectedSkill?.prompt ?? "";
            const instructionText = prompt && !requested.startsWith(prompt) ? `${prompt}\n\n追加指示: ${requested}` : requested;
            // 非連続の複数対象を個別範囲へ順に適用すると位置ずれで範囲外を壊し得る。
            // 複数時は文書全体の提案だけを採用確認へ渡し、現在本文との一致も確認する。
            const target = targets.length === 1 ? targets[0].snapshot : null;
            const multipleSelection = targets.length > 1 && mode === "selection";
            const multiQuestion = targets.length > 1 && mode === "question";
            const effectiveMode: CodexEditMode = targets.length > 1 && mode !== "question" ? "document" : mode;
            const scoped = scopeRequest(snapshot, target, effectiveMode, instructionText);
            const historicalIds = session.messages.flatMap(message => message.attachmentIds);
            const attachments = conversationRef.current.attachments.filter(item => ids.includes(item.id) || historicalIds.includes(item.id));
            if (selectedSkill?.config.inputs.includes("image") && !attachments.length) throw new Error("このスキルには画像が必要です。画像を追加してください。");
            const labels = attachments.map((item, index) => `${index + 1}枚目=${item.label}`).join("、");
            // 複数対象の質問は、選択外の本文を送らず、名前ごとの抜粋だけを渡す。
            const text = selectedSkill?.config.inputs.includes("text") === false ? "" : multiQuestion ? targets.map(item => `${item.label}:\n${item.snapshot.content.slice(item.snapshot.from, item.snapshot.to)}`).join("\n\n") : (!target && mode === "question") ? "" : scoped.text;
            const targetDescription = targets.length ? targets.map(item => `${item.label}: 文字位置${item.snapshot.from}〜${item.snapshot.to}`).join("、") : "";
            const instruction = `${scoped.instruction}${text ? targetDescription ? `\n今回の対象: ${targetDescription}。${multiQuestion ? "入力本文は追加した対象だけです。" : targets.length > 1 || effectiveMode === "document" ? "入力本文は文書全体です。" : "入力本文がこの対象です。"}${multipleSelection ? "指定した位置以外は変更しないでください。" : ""}` : "\n入力本文全体を参照してください。" : ""}${!diagramKind && effectiveDiagramKind && /^\s*(?:`{3,}|~{3,})/.test(scoped.text) ? "\n対象はMarkdownの図コードブロックです。replacementには元と同じ言語のコードフェンスを含む対象全体を返してください。" : ""}${labels ? `\n\n添付画像の順序: ${labels}\n今回の添付: ${ids.map(imageId => attachments.find(item => item.id === imageId)?.label).join("、") || "なし（過去の添付は履歴の参照用です）"}` : ""}`;
            const history = session.messages.map(({ role, text: message, attachmentIds, attachmentLabels }) => ({ role, text: message + (attachmentIds.length ? `\n添付: ${attachmentIds.map(imageId => attachmentLabels?.[imageId] ?? session.attachments.find(item => item.id === imageId)?.label ?? "画像データなし").join("、")}` : "") }));
            if (history.length > 40 || requestBytes(instruction, text, history) > 120000) throw new Error("送信量が上限を超えています。新しい会話を開始してください。");
            const user = { role: "user" as const, text: requested + (text ? `\n\n${targets.length ? `${multiQuestion ? "対象テキスト" : targets.length > 1 || effectiveMode === "document" ? "文書全体" : targets[0].label}（${targetDescription}）` : "文書全体"}:\n${text}` : ""), attachmentIds: ids, attachmentLabels: Object.fromEntries(ids.map(imageId => [imageId, conversationRef.current.attachments.find(item => item.id === imageId)?.label ?? "画像データなし"])), timestamp: iso() };
            const reply = await generateCodex({ id, instruction: diagramKind ? diagramInstruction(diagramKind, instruction) : instruction, text, history, ...(attachments.length ? { images: attachments.map(item => ({ base64: item.base64 })) } : {}) });
            if (!mounted.current || active.current !== id || conversationId.current !== sessionId) return;
            const time = iso();
            updateConversation(value => value.id !== sessionId ? value : { ...value, messages: [...value.messages, user, { role: "assistant", text: reply.answer + (reply.replacement === null ? "" : `\n\n変更案:\n${reply.replacement}`), attachmentIds: [], timestamp: time }], draft: { ...value.draft, instruction: "", attachmentIds: [], targetSnapshot: null, targetLabel: undefined, textTargets: [], editMode: "question" }, lastMessageAt: time, updatedAt: time, contextTokens: reply.inputTokens ?? value.contextTokens });
            setSelectedImageId(undefined); setIgnoredTarget(suppliedTarget ?? null);
            if (mode !== "question" && reply.replacement !== null) setProposal({ base: scoped.base, original: scoped.text, value: reply.replacement, ...(multipleSelection ? { allowedRanges: targets.map(item => ({ from: item.snapshot.from, to: item.snapshot.to })) } : {}) });
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
            if (proposal.allowedRanges && !replacementMatchesTargetRanges(proposal.original, value, proposal.allowedRanges))
                throw new Error("指定場所のみ編集では、指定した範囲外を変更する提案は採用できません。");
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
    const currentTextTargets = textTargets(conversation.draft);
    const permissionControl = <select className="codex-panel__edit-permission" aria-label="編集の許可" disabled={busy} value={mode === "selection" && !currentTextTargets.length ? "document" : mode} onChange={event => updateConversation(value => ({ ...value, updatedAt: iso(), draft: { ...value.draft, editMode: event.target.value as CodexEditMode } }))}><option value="question">質問のみ</option>{currentTextTargets.length > 0 && <option value="selection">指定場所のみ編集</option>}<option value="document">全文から編集</option></select>;
    return <aside hidden={!open} className="codex-panel" style={{ "--codex-panel-width": `${width}px` } as React.CSSProperties} aria-label="AI文章アシスタント" onKeyDown={event => {
        if (event.key !== "Escape") return;
        event.preventDefault(); event.stopPropagation();
        if (applyingRef.current) return;
        if (proposal) setProposal(null); else if (historyOpen) setHistoryOpen(false); else if (logsOpen) setLogsOpen(false); else { stop(); onClose(); }
    }}>
    <div className="codex-panel__resize" role="separator" tabIndex={0} aria-label="AIパネルの幅を変更" aria-orientation="vertical" aria-valuemin={300} aria-valuemax={760} aria-valuenow={width}
      onPointerDown={event => { event.preventDefault(); event.currentTarget.focus(); event.currentTarget.setPointerCapture?.(event.pointerId); }}
      onPointerMove={event => { if (event.buttons === 1) setWidth(Math.max(300, Math.min(760, window.innerWidth - event.clientX))); }}
      onKeyDown={event => { if (event.key === "ArrowLeft" || event.key === "ArrowRight") { event.preventDefault(); setWidth(value => Math.max(300, Math.min(760, value + (event.key === "ArrowLeft" ? 20 : -20)))); } }} />
    <header inert={!!proposal || historyOpen || logsOpen}><button type="button" onClick={newConversation}>新しい会話を開始</button><div><button type="button" onClick={() => { if (busy)
        stop(); setHistoryOpen(true); }}>会話履歴（{sessions.length}）</button><button type="button" onClick={() => void listCodexLogs().then((data) => { setLogs(data); setLogsOpen(true); }).catch((cause) => setError(String(cause)))}>通信記録（{logs.entries.length}）</button><button type="button" onClick={onClose} aria-label="AIパネルを閉じる">×</button></div></header>
    <div ref={body} className="codex-panel__body" inert={!!proposal || historyOpen || logsOpen} style={{ "--codex-chat-ratio": `${chatRatio}%` } as React.CSSProperties}>
      <section className="codex-panel__conversation">
        <h2>会話ログ</h2>
        <div ref={chat} className="codex-panel__chat" role="log" aria-label="会話ログ" aria-busy={busy}>
          {conversation.messages.length === 0 && <p className="codex-panel__empty">ここに会話が表示されます。</p>}
          {conversation.messages.map((message, index) => <section className={`codex-message codex-message--${message.role}`} key={`${message.timestamp}-${index}`}>
            <strong>{message.role === "user" ? "あなた" : "AI"}</strong><pre>{message.text}</pre>
            {message.attachmentIds.map(id => { const attachment = conversation.attachments.find(item => item.id === id); const label = message.attachmentLabels?.[id] ?? attachment?.label ?? "画像データなし"; return attachment ? <button key={id} type="button" className="codex-message__image" onClick={() => { saveConversation(conversationRef.current, true); setSessions(current => [conversationRef.current, ...current.filter(item => item.id !== conversationRef.current.id)]); setHistoryOpen(true); }}><img src={`data:${attachment.mime};base64,${attachment.base64}`} alt={`${label}のサムネイル`} />{label}</button> : <small key={id}>{label}</small>; })}
          </section>)}
        </div>
      </section>
      <div className="codex-panel__chat-resize" role="separator" tabIndex={0} aria-label="会話ログと指示文の高さを変更" aria-orientation="horizontal" aria-valuemin={20} aria-valuemax={75} aria-valuenow={chatRatio}
        onPointerDown={event => { event.preventDefault(); event.currentTarget.focus(); event.currentTarget.setPointerCapture?.(event.pointerId); }}
        onPointerMove={event => { if (event.buttons !== 1 || !event.currentTarget.hasPointerCapture?.(event.pointerId)) return; const bounds = body.current?.getBoundingClientRect(); if (bounds?.height) setChatRatio(Math.max(20, Math.min(75, (event.clientY - bounds.top) / bounds.height * 100))); }}
        onKeyDown={event => { if (event.key === "ArrowUp" || event.key === "ArrowDown" || event.key === "Home" || event.key === "End") { event.preventDefault(); setChatRatio(value => event.key === "Home" ? 20 : event.key === "End" ? 75 : Math.max(20, Math.min(75, value + (event.key === "ArrowUp" ? -5 : 5)))); } }} />
      <section className="codex-panel__composer" aria-label="次回送信する内容">
        {busy && <div className="codex-panel__sending" role="status"><span className="codex-panel__spinner" aria-hidden="true" />送信中・AIの回答を待っています…</div>}
        {!imageEditAction && <div className="codex-panel__prompt">
          <label>指示文<textarea aria-label="指示" ref={input} value={conversation.draft.instruction} rows={7} disabled={busy || applying || saving || !ready}
            placeholder="例: 画像1を見ながら、テキスト1について説明してください。"
            onChange={event => updateConversation(value => ({ ...value, updatedAt: iso(), draft: { ...value.draft, instruction: event.target.value } }))}
            onKeyDown={event => { if (!event.nativeEvent.isComposing && event.key === "Enter" && (event.ctrlKey || event.metaKey)) { event.preventDefault(); void send(); } }} />
          </label>
          <div className="codex-panel__send-actions"><button type="button" aria-label="送信（Ctrl+Enter）" disabled={!ready || options.tool !== "codex-cli" || busy || preparingImage || applying || saving || !available || !conversation.draft.instruction.trim()} onClick={() => void send()}>{busy ? "送信中…" : "送信"}<small>（Ctrl+Enter）</small></button><button type="button" disabled={!busy} onClick={stop}>停止</button>{permissionControl}</div>
        </div>}
        {editing && !effectiveDiagramKind && selectedSkill?.config.mode === "selection" && editing.mime === "image/png" && <CodexImageEdit actionFooter={permissionControl} documentPath={documentPath} source={selected!.imageSource!} originalBase64={editing.base64} disabled={!ready || options.tool !== "codex-cli" || saving} onRequestAuthorization={requestAiAuthorization} initialInstruction={`${selectedSkill.prompt}\n今回の画像は${editing.label}です。`} instruction={conversation.draft.instruction} onBusyChange={setImageBusy} onGenerated={instruction => {
            const time = iso();
            updateConversation(value => ({ ...value, messages: [...value.messages, { role: "user", text: instruction, attachmentIds: [editing.id], timestamp: time }, { role: "assistant", text: "画像を生成しました。変更前後を確認して採用できます。", attachmentIds: [], timestamp: time }], draft: { ...value.draft, instruction: "", attachmentIds: [], targetSnapshot: null, targetLabel: undefined, textTargets: [] }, lastMessageAt: time, updatedAt: time }));
        }} onInstructionChange={instruction => updateConversation(value => ({ ...value, updatedAt: iso(), draft: { ...value.draft, instruction } }))} onReferenceChange={async (source, replacement) => {
            const snapshot = getSnapshot();
            if (!snapshot || !selected || !canApplyProposal(snapshot, selected)) return false;
            const occurrence = transcriptionImages(snapshot.content).find(item => item.source === source && item.start >= selected.from && item.end <= selected.to);
            if (!occurrence) return false;
            const changed = replaceImageOccurrenceSource(snapshot.content, occurrence, replacement);
            return applyProposal({ ...snapshot, from: 0, to: snapshot.content.length }, changed);
        }}/>}
        <fieldset className="codex-panel__tool" disabled={!ready || busy || imageBusy || saving}>
          <div className="codex-panel__tool-fields">
            <label>ツール<select aria-label="ツール" value={options.tool} onChange={event => setOptions({ ...options, tool: event.target.value as typeof options.tool, enabled: false })}>
              <option value="codex-cli">Codex CLI</option><option value="chatgpt-api">ChatGPT API（未実装）</option><option value="claude-cli">Claude CLI（未実装）</option><option value="claude-api">Claude API（未実装）</option><option value="copilot-cli">Copilot CLI（未実装）</option><option value="copilot-chat-cli">Copilot Chat CLI（未実装）</option>
            </select></label>
            <label>モデル<input list={modelsId} value={options.model} onChange={event => setOptions({ ...options, model: event.target.value })}/><datalist id={modelsId}>{[...new Set([savedOptions.model, DEFAULT_CODEX_OPTIONS.model, "gpt-5.6-terra", "gpt-6-astra"])].map(model => <option key={model} value={model} />)}</datalist></label>
          </div>
          <div className="codex-panel__tool-actions">{options.tool !== "codex-cli" && <small role="status">選択したAIツールは未実装です。送信できません。</small>}
            {settingsDirty && <button type="button" onClick={() => void (async () => { setSaving(true); try { const value = normalizeCodexOptions(options); await saveSettings({ codex: value }); setSavedOptions(value); } catch (cause) { setError(String(cause)); } finally { setSaving(false); } })()}>設定を保存</button>}
          </div>
        </fieldset>
        <section className="codex-panel__scope" aria-label="今回の対象" inert={imageBusy || !sessionsReady}>
          <div className="codex-panel__scope-heading"><strong>次回送信する対象・添付</strong><span className="codex-panel__hint" tabIndex={0} aria-label="対象と添付の説明">i<span role="tooltip">次回の送信に追加する資料です。送信成功後は履歴に残り、この一覧から外れます。</span></span></div>
          <div className="codex-panel__actions">
            <button type="button" disabled={busy} onClick={captureText}>選択テキストを追加</button>
          </div>
          {currentTextTargets.length > 0 && <ul className="codex-panel__text-targets" aria-label="追加したテキスト">{currentTextTargets.map((item, index) => <li key={item.id}><input aria-label={`${item.label}の名前`} value={item.label} disabled={busy} onChange={event => updateConversation(value => ({ ...value, updatedAt: iso(), draft: { ...value.draft, textTargets: textTargets(value.draft).map(target => target.id === item.id ? { ...target, label: event.target.value } : target) } }))} onBlur={() => updateConversation(value => ({ ...value, updatedAt: iso(), draft: { ...value.draft, textTargets: textTargets(value.draft).map(target => target.id === item.id && !target.label.trim() ? { ...target, label: `テキスト${index + 1}` } : target) } }))}/><small>{item.snapshot.content.slice(item.snapshot.from, item.snapshot.to)}</small><button type="button" disabled={busy} onClick={() => updateConversation(value => ({ ...value, updatedAt: iso(), draft: { ...value.draft, textTargets: textTargets(value.draft).filter(target => target.id !== item.id), targetSnapshot: null, targetLabel: undefined, editMode: textTargets(value.draft).length === 1 && value.draft.editMode === "selection" ? "question" : value.draft.editMode } }))}>外す</button></li>)}</ul>}
          <div className="codex-panel__actions">
            <button type="button" disabled={busy || preparingImage} onClick={() => fileInput.current?.click()}>画像ファイルを追加</button>
            <input ref={fileInput} className="codex-panel__file-input" hidden type="file" accept="image/png" aria-label="添付するPNG画像" onChange={event => void addFile(event)}/>
            {selected?.imageSource && <button type="button" disabled={busy} onClick={() => void addSelectedImage()}>現在の画像を追加</button>}
          </div>
          {conversation.draft.attachmentIds.length > 0 && <ul aria-label="追加した画像">{conversation.draft.attachmentIds.map((id, index) => { const attachment = conversation.attachments.find(item => item.id === id); return attachment && <li key={id}><img src={`data:${attachment.mime};base64,${attachment.base64}`} alt={`${attachment.label}のサムネイル`}/><input aria-label={`${attachment.label}の名前`} value={attachment.label} disabled={busy} onChange={event => updateConversation(value => ({ ...value, updatedAt: iso(), attachments: value.attachments.map(image => image.id === id ? { ...image, label: event.target.value } : image) }))} onBlur={() => updateConversation(value => ({ ...value, updatedAt: iso(), attachments: value.attachments.map(image => image.id === id && !image.label.trim() ? { ...image, label: `画像${index + 1}` } : image) }))}/><small>{attachment.name}</small><button type="button" disabled={busy} onClick={() => { updateConversation(value => ({ ...value, updatedAt: iso(), draft: { ...value.draft, attachmentIds: value.draft.attachmentIds.filter(valueId => valueId !== id) } })); if (selectedImageId === id) setSelectedImageId(undefined); }}>外す</button></li>; })}</ul>}
          {!currentTextTargets.length && conversation.draft.attachmentIds.length === 0 && <p>対象・添付は未登録です。</p>}
        </section>
        {preparingImage && <p role="status">画像を準備しています…</p>}
        {error && !proposal && <p role="alert">{error}</p>}
      </section>
    </div>
    {proposal && <div className="codex-proposal-preview" role="dialog" aria-modal="true" aria-label="AI変更案のプレビュー"><CodexProposalReview original={proposal.original} value={proposal.value} onChange={(value) => setProposal((old) => old ? { ...old, value } : null)} renderPreview={diagramKind ? (value) => renderProposal?.(value) : (value) => <CodexMarkdownPreview source={value} baseDir={baseDir}/>} validate={diagramKind ? async (value) => { await validateDiagramForAdoption(diagramKind, value); } : undefined} onAccept={accept} onReject={() => setProposal(null)} onClose={() => setProposal(null)} busy={applying} error={error}/></div>}
    {historyOpen && <CodexConversationHistory sessions={sessions} selectedId={conversation.id} retentionDays={retention} onDelete={deleteConversation} onClose={() => setHistoryOpen(false)} onSelect={(id) => { const item = sessions.find((value) => value.id === id); if (item) {
        stop();
        saveConversation(conversationRef.current, true);
        setIgnoredTarget(suppliedTarget ?? null); setProposal(null); setSelectedImageId(undefined);
        const snapshot = getSnapshot();
        const targets = textTargets(item.draft);
        replaceConversation(item.documentPath === documentPath && snapshot && targets.every(target => target.snapshot.content === snapshot.content) ? { ...item, draft: { ...item.draft, targetSnapshot: null, targetLabel: undefined, textTargets: targets.map(target => ({ ...target, snapshot: { ...target.snapshot, documentId: snapshot.documentId } })) } } : item);
    } setHistoryOpen(false); }} onRetentionChange={(days) => { void setCodexSessionRetention(days).then((store) => { setSessions(store.sessions); setRetention(store.retentionDays); void listCodexLogs().then(setLogs).catch(() => {}); const cutoff = Date.now() - days * 86400000; if (days === 0 || Date.parse(conversationRef.current.updatedAt) < cutoff) replaceConversation(fresh(current?.documentId ?? "", documentPath, documentName)); }).catch((cause) => setError(String(cause))); }}/>}
    {logsOpen && <CodexLogViewer data={logs} onClose={() => setLogsOpen(false)} onLimitChange={async (limit) => { setLogs(await setCodexLogLimit(limit)); }}/>}
  </aside>;
}
