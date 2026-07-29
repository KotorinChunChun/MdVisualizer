import { useEffect, useState } from "react";
import type { ExternalAppConfig } from "../types/settings";
import { validateExternalApp } from "../types/settings";
import "../styles/settings.css";

export function SettingsPanel({
  apps,
  onSave,
}: {
  apps: ExternalAppConfig[];
  onSave: (apps: ExternalAppConfig[]) => Promise<void>;
}) {
  const [draft, setDraft] = useState(() => apps.map((app) => ({ ...app, args: [...app.args] })));
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => setDraft(apps.map((app) => ({ ...app, args: [...app.args] }))), [apps]);

  const update = (id: string, patch: Partial<ExternalAppConfig>) => {
    setDraft((current) => current.map((app) => app.id === id ? { ...app, ...patch } : app));
  };
  const move = (index: number, delta: number) => {
    setDraft((current) => {
      const target = index + delta;
      if (target < 0 || target >= current.length) return current;
      const next = [...current];
      [next[index], next[target]] = [next[target], next[index]];
      return next.map((app, order) => ({ ...app, order }));
    });
  };
  const save = async () => {
    const validation = draft.map(validateExternalApp).find(Boolean);
    if (validation) { setError(validation); return; }
    setSaving(true);
    setError(null);
    try {
      await onSave(draft.map((app, order) => ({ ...app, order })));
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
    <div className="settings-list">
      {draft.map((app, index) => <article className="settings-app" key={app.id}>
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
          <button type="button" disabled={index === 0} onClick={() => move(index, -1)}>上へ</button>
          <button type="button" disabled={index === draft.length - 1} onClick={() => move(index, 1)}>下へ</button>
          <button type="button" disabled={Boolean(app.builtinKind)} onClick={() => setDraft((current) => current.filter((candidate) => candidate.id !== app.id))}>削除</button>
        </div>
      </article>)}
    </div>
    <button type="button" onClick={() => setDraft((current) => [...current, {
      id: `custom-${Date.now()}`,
      label: "新しいアプリ",
      executable: "",
      args: ["${file}"],
      workingDirectory: "${dir}",
      enabled: true,
      placement: "menu",
      order: current.length,
    }])}>アプリを追加</button>
  </section>;
}
