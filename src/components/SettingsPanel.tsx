import { useEffect, useState } from "react";
import type { ExternalAppConfig, ExternalAppTarget } from "../types/settings";
import { DEFAULT_IMAGE_A4_TARGET_WIDTH, DEFAULT_IMAGE_EQUAL_PADDING, validateExternalApp } from "../types/settings";
import { DEFAULT_SYNTAX_HIGHLIGHT_SETTINGS, SYNTAX_HIGHLIGHT_THEMES, type SyntaxHighlightSettings, type SyntaxHighlightTheme } from "../lib/syntaxHighlight";
import "../styles/settings.css";

export function SettingsPanel({
  apps,
  presentationLineThreshold,
  imageA4TargetWidth = DEFAULT_IMAGE_A4_TARGET_WIDTH,
  imageEqualPadding = DEFAULT_IMAGE_EQUAL_PADDING,
  syntaxHighlight = DEFAULT_SYNTAX_HIGHLIGHT_SETTINGS,
  onSave,
}: {
  apps: ExternalAppConfig[];
  presentationLineThreshold: number;
  imageA4TargetWidth?: number;
  imageEqualPadding?: number;
  syntaxHighlight?: SyntaxHighlightSettings;
  onSave: (apps: ExternalAppConfig[], presentationLineThreshold: number, imageA4TargetWidth: number, imageEqualPadding: number, syntaxHighlight: SyntaxHighlightSettings) => Promise<void>;
}) {
  const [draft, setDraft] = useState(() => apps.map((app) => ({ ...app, args: [...app.args] })));
  const [lineThreshold, setLineThreshold] = useState(presentationLineThreshold);
  const [a4TargetWidth, setA4TargetWidth] = useState(imageA4TargetWidth);
  const [equalPadding, setEqualPadding] = useState(imageEqualPadding);
  const [syntaxDraft, setSyntaxDraft] = useState<SyntaxHighlightSettings>(() => ({ ...syntaxHighlight }));
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => setDraft(apps.map((app) => ({ ...app, args: [...app.args] }))), [apps]);
  useEffect(() => setLineThreshold(presentationLineThreshold), [presentationLineThreshold]);
  useEffect(() => setA4TargetWidth(imageA4TargetWidth), [imageA4TargetWidth]);
  useEffect(() => setEqualPadding(imageEqualPadding), [imageEqualPadding]);
  useEffect(() => setSyntaxDraft({ ...syntaxHighlight }), [syntaxHighlight]);

  const update = (id: string, patch: Partial<ExternalAppConfig>) => {
    setDraft((current) => current.map((app) => app.id === id ? { ...app, ...patch } : app));
  };
  const move = (target: ExternalAppTarget, index: number, delta: number) => {
    setDraft((current) => {
      const targetIndex = index + delta;
      const group = current.filter((app) => app.target === target);
      if (targetIndex < 0 || targetIndex >= group.length) return current;
      [group[index], group[targetIndex]] = [group[targetIndex], group[index]];
      let groupIndex = 0;
      return current.map((app) => app.target === target ? group[groupIndex++] : app)
        .map((app, order) => ({ ...app, order }));
    });
  };
  const addApp = (target: ExternalAppTarget) => setDraft((current) => [...current, {
    id: `custom-${Date.now()}`,
    label: "新しいアプリ",
    executable: "",
    args: ["${file}"],
    workingDirectory: "${dir}",
    enabled: true,
    placement: "menu",
    order: current.length,
    target,
  }]);
  const save = async () => {
    const validation = draft.map(validateExternalApp).find(Boolean);
    if (validation) { setError(validation); return; }
    setSaving(true);
    setError(null);
    try {
      await onSave(draft.map((app, order) => ({ ...app, order })), lineThreshold, a4TargetWidth, equalPadding, syntaxDraft);
    } catch (reason) {
      setError(String(reason));
    } finally {
      setSaving(false);
    }
  };

  return <section className="settings-panel" aria-labelledby="settings-title">
    <header>
      <div><h1 id="settings-title">設定</h1><p>外部アプリの表示場所と安全な起動引数を管理します。</p></div>
      <button type="button" className="settings-save" disabled={saving} onClick={() => void save()}>{saving ? "保存中…" : "保存"}</button>
    </header>
    {error && <p role="alert" className="settings-error">{error}</p>}
    <fieldset className="settings-section">
      <legend>プレゼンテーション</legend>
      <label>短い子見出しを親へ含める最大ソース行数
        <input aria-label="プレゼン統合行数" type="number" min="1" max="100" value={lineThreshold} onChange={(event) => setLineThreshold(Math.min(100, Math.max(1, Number(event.target.value) || 1)))} />
      </label>
    </fieldset>
    <fieldset className="settings-section">
      <legend>画像編集</legend>
      <label>A4横の想定横幅（px）
        <input aria-label="A4横の想定横幅" type="number" min="1" value={a4TargetWidth} onChange={(event) => setA4TargetWidth(Math.max(1, Number(event.target.value) || 1))} />
      </label>
      <label>四辺の等間隔余白（px）
        <input aria-label="四辺の等間隔余白" type="number" min="0" value={equalPadding} onChange={(event) => setEqualPadding(Math.max(0, Number(event.target.value) || 0))} />
      </label>
    </fieldset>
    <fieldset className="settings-section syntax-highlight-settings">
      <legend>シンタックスハイライト</legend>
      <label>配色プリセット
        <select aria-label="シンタックス配色" value={syntaxDraft.theme} onChange={(event) => setSyntaxDraft((current) => ({ ...current, theme: event.target.value as SyntaxHighlightTheme }))}>
          {SYNTAX_HIGHLIGHT_THEMES.map((value) => <option key={value} value={value}>{({ adaptive: "テーマに合わせる", "github-light": "GitHub Light", "github-dark": "GitHub Dark", monokai: "Monokai", solarized: "Solarized Dark" } as const)[value]}</option>)}
        </select>
      </label>
      <label className="syntax-highlight-settings__toggle"><span>背景色と本文色を上書き</span>
        <input aria-label="コード基本色を上書き" type="checkbox" checked={syntaxDraft.customColors} onChange={(event) => setSyntaxDraft((current) => ({ ...current, customColors: event.target.checked }))} />
      </label>
      <div className="syntax-highlight-settings__colors">
        <label>背景色<input aria-label="コード背景色" type="color" disabled={!syntaxDraft.customColors} value={syntaxDraft.background} onChange={(event) => setSyntaxDraft((current) => ({ ...current, background: event.target.value }))} /></label>
        <label>本文色<input aria-label="コード本文色" type="color" disabled={!syntaxDraft.customColors} value={syntaxDraft.foreground} onChange={(event) => setSyntaxDraft((current) => ({ ...current, foreground: event.target.value }))} /></label>
      </div>
      <pre
        className="code-block syntax-highlight-preview"
        data-syntax-theme={syntaxDraft.theme}
        style={syntaxDraft.customColors ? { "--code-block-bg": syntaxDraft.background, "--code-block-color": syntaxDraft.foreground } as React.CSSProperties : undefined}
        aria-label="シンタックス配色プレビュー"
      ><code><span className="hljs-keyword">const</span> <span className="hljs-title">answer</span> = <span className="hljs-number">42</span>; <span className="hljs-comment">// preview</span></code></pre>
    </fieldset>
    <div className="settings-app-groups">
      {(["document", "image"] as const).map((target) => {
        const group = draft.filter((app) => app.target === target);
        const sectionName = target === "document" ? "文書用アプリ" : "画像用アプリ";
        return <section className="settings-app-group" key={target} aria-labelledby={`settings-${target}-apps`}>
          <header><h2 id={`settings-${target}-apps`}>{sectionName}</h2><p>{target === "document" ? "Markdown文書を開くアプリです。" : "画像プレビューから開くアプリです。"}</p></header>
          <div className="settings-list">
      {group.map((app, index) => <article className="settings-app" key={app.id}>
        <div className="settings-app__heading">
          <strong>{app.label || "名称未設定"}</strong>
          <label><input type="checkbox" checked={app.enabled} onChange={(event) => update(app.id, { enabled: event.target.checked })} /> 有効</label>
        </div>
        <label>表示名<input value={app.label} onChange={(event) => update(app.id, { label: event.target.value })} /></label>
        <label>表示場所<select value={app.placement} onChange={(event) => update(app.id, { placement: event.target.value as ExternalAppConfig["placement"] })}><option value="primary">直接ボタン</option><option value="menu">その他メニュー</option></select></label>
        {app.builtinKind ? <p className="settings-builtin">組み込み: {app.builtinKind}</p> : <>
          <label>実行ファイル<input value={app.executable} onChange={(event) => update(app.id, { executable: event.target.value })} placeholder="C:\\Tools\\viewer.exe" /></label>
          <label>引数（1行につき1引数）<textarea value={app.args.join("\n")} onChange={(event) => update(app.id, { args: event.target.value.split(/\r?\n/) })} placeholder={"${file}\n--line\n${line}"} /></label>
          <label>作業フォルダー<input value={app.workingDirectory} onChange={(event) => update(app.id, { workingDirectory: event.target.value })} placeholder="${dir}" /></label>
        </>}
        <div className="settings-app__actions">
          <button type="button" disabled={index === 0} onClick={() => move(target, index, -1)}>上へ</button>
          <button type="button" disabled={index === group.length - 1} onClick={() => move(target, index, 1)}>下へ</button>
          <button type="button" disabled={app.builtinKind === "folder"} onClick={() => setDraft((current) => current.filter((candidate) => candidate.id !== app.id))}>削除</button>
        </div>
      </article>)}</div>
          <button type="button" className="settings-add-app" onClick={() => addApp(target)}>{sectionName}を追加</button>
        </section>;
      })}
    </div>
  </section>;
}
