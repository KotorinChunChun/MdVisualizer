import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { DEFAULT_SKILL_FILES, SKILL_TARGETS, deleteSkillFile, parseSkill, reloadSkills, saveSkillFile, skillDirectory, updateSkillConfig, useCodexSkills, visibleSkills, type SkillTarget } from "./skills";
import "./skills.css";
const labels = { text: "通常テキスト", code: "コードブロック", mermaid: "Mermaid", drawio: "draw.io", svg: "SVG", image: "PNGなどの画像" };
export function CodexSkillSettings() {
  const skills = useCodexSkills();
  const [selected, setSelected] = useState(""); const [source, setSource] = useState(""); const [drafts, setDrafts] = useState<Record<string, string>>({}); const [search, setSearch] = useState("");
  const [error, setError] = useState(""); const [status, setStatus] = useState(""); const [busy, setBusy] = useState(false); const [target, setTarget] = useState<SkillTarget>("text");
  const skill = parseSkill({ id: selected, source });
  async function run(action: () => Promise<unknown>) { setBusy(true); setError(""); try { await action(); setStatus("設定を反映しました。"); } catch (e) { setError(String(e)); } finally { setBusy(false); } }
  function setDraft(next: string) { setSource(next); if (selected) setDrafts((current) => ({ ...current, [selected]: next })); }
  function update(patch: Partial<typeof skill.config>) { setDraft(updateSkillConfig(skill, { ...skill.config, ...patch })); }
  return <section className="codex-skill-settings" aria-label="AIのスキルとメニュー"><h2>AI — スキルとメニュー</h2>
    <p>スキルを選び、対象と表示場所を設定してください。本文はAIに送るプロンプトです。</p><code>{skillDirectory()}</code>
    <div><button type="button" onClick={() => void run(() => invoke("codex_open_skills_folder"))}>フォルダーを開く</button><button type="button" onClick={() => void run(reloadSkills)}>再読み込み</button><button type="button" onClick={() => { const id = `custom-${Date.now()}`; setSelected(id); setSource(`---\nname: ${id}\ndescription: 新しいスキル\n---\n\n対象について日本語で回答してください。\n`); }}>スキルを追加</button></div>
    <div className="codex-skill-settings__columns"><aside><input aria-label="スキルを検索" value={search} onChange={(e) => setSearch(e.target.value)} />{skills.filter(s => `${s.name} ${s.description}`.includes(search)).map(s => <button key={s.id} type="button" aria-pressed={s.id === selected} onClick={() => { setSelected(s.id); setSource(drafts[s.id] ?? s.source); setStatus(""); }}>{s.config.label}{s.error ? "（エラー）" : !s.config.enabled ? "（無効・未設定）" : ""}</button>)}</aside>
    {selected && <fieldset disabled={busy}><legend>{selected}</legend><label>表示名<input value={skill.config.label} onChange={e => update({ label: e.target.value })}/></label><label><input type="checkbox" checked={skill.config.enabled} onChange={e => update({ enabled: e.target.checked })}/>有効</label>
      <table><thead><tr><th>対象</th><th>対象</th><th>右クリック</th><th>ブロックメニュー</th></tr></thead><tbody>{SKILL_TARGETS.map(t => { const contextTargets = skill.config.contextTargets ?? (skill.config.contextMenu ? skill.config.targets : []); const blockTargets = skill.config.blockTargets ?? (skill.config.blockMenu ? skill.config.targets : []); const blockAllowed = t !== "text" && t !== "image"; return <tr key={t}><td>{labels[t]}</td><td><input type="checkbox" aria-label={`${labels[t]}を対象にする`} checked={skill.config.targets.includes(t)} onChange={e => update({ targets: e.target.checked ? [...skill.config.targets, t] : skill.config.targets.filter(x => x !== t) })}/></td><td><input type="checkbox" aria-label={`${labels[t]}の右クリックメニューに表示`} checked={contextTargets.includes(t)} onChange={e => update({ contextTargets: e.target.checked ? [...contextTargets, t] : contextTargets.filter(x => x !== t) })}/></td><td><input type="checkbox" disabled={!blockAllowed} aria-label={`${labels[t]}のブロックメニューに表示`} checked={blockAllowed && blockTargets.includes(t)} onChange={e => update({ blockTargets: e.target.checked ? [...blockTargets, t] : blockTargets.filter(x => x !== t) })}/></td></tr>; })}</tbody></table>
      <label>動作<select value={skill.config.mode} onChange={e => update({ mode: e.target.value === "selection" ? "selection" : "question" })}><option value="question">相談（テキスト回答）</option><option value="selection">修正案を作成</option></select></label>
      <div>送信する情報{(["text", "image"] as const).map(input => <label key={input}><input type="checkbox" checked={skill.config.inputs.includes(input)} onChange={e => update({ inputs: e.target.checked ? [...skill.config.inputs, input] : skill.config.inputs.filter(x => x !== input) })}/>{input === "text" ? "テキスト・元コード" : "可視化後の画像"}</label>)}</div>
      <label>表示順<input type="number" value={skill.config.order} onChange={e => update({ order: Number(e.target.value) })}/></label>
      <label>スキルファイル（属性とプロンプト）<textarea rows={12} value={source} onChange={e => setDraft(e.target.value)}/></label>{skill.error && <p role="alert">{skill.error}</p>}
      <button type="button" disabled={!!skill.error} onClick={() => void run(async () => { await saveSkillFile(selected, source); setDrafts((current) => { const next = { ...current }; delete next[selected]; return next; }); })}>スキルを保存</button><button type="button" onClick={() => setDraft(skills.find(s => s.id === selected)?.source ?? source)}>変更を破棄</button>
      {DEFAULT_SKILL_FILES.some(s => s.id === selected) && <button type="button" onClick={() => setDraft(DEFAULT_SKILL_FILES.find(s => s.id === selected)!.source)}>既定に戻す</button>}
      <button type="button" onClick={() => void run(async () => { await deleteSkillFile(selected); setSelected(""); })}>スキルを削除</button>
    </fieldset>}</div>
    <label>メニュープレビュー<select value={target} onChange={e => setTarget(e.target.value as SkillTarget)}>{SKILL_TARGETS.map(t => <option value={t} key={t}>{labels[t]}</option>)}</select></label><ul>{visibleSkills(selected ? skills.map(s => s.id === selected ? skill : s) : skills, target, "contextMenu").map(s => <li key={s.id}>{s.config.label}</li>)}</ul>
    {error && <p role="alert">{error}</p>}<p role="status">{status}</p>
  </section>;
}
