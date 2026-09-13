import { parse, stringify } from "yaml";
import { invoke } from "@tauri-apps/api/core";
import { useEffect, useSyncExternalStore } from "react";
import consult from "./default-skills/consult/SKILL.md?raw";
import edit from "./default-skills/edit/SKILL.md?raw";
import explain from "./default-skills/explain-image/SKILL.md?raw";
import transcribe from "./default-skills/transcribe/SKILL.md?raw";
import table from "./default-skills/transcribe-table/SKILL.md?raw";
import improve from "./default-skills/improve-diagram/SKILL.md?raw";
import diagram from "./default-skills/edit-diagram/SKILL.md?raw";
import imageEdit from "./default-skills/edit-image/SKILL.md?raw";

export const SKILL_TARGETS = ["text", "code", "mermaid", "drawio", "svg", "image"] as const;
export type SkillTarget = typeof SKILL_TARGETS[number];
export interface SkillConfig { label: string; enabled: boolean; targets: SkillTarget[]; inputs: ("text" | "image")[]; mode: "question" | "selection"; contextMenu: boolean; blockMenu: boolean; contextTargets?: SkillTarget[]; blockTargets?: SkillTarget[]; order: number }
export interface CodexSkill { id: string; name: string; description: string; source: string; prompt: string; config: SkillConfig; error?: string }
export interface SkillFile { id: string; source: string }
export interface SkillFiles { directory: string; files: SkillFile[] }
export const DEFAULT_SKILL_FILES: SkillFile[] = [consult, edit, explain, transcribe, table, improve, diagram, imageEdit].map((source) => ({ id: String(parse(source.split(/^---\s*$/m)[1]).name), source }));
function displaySkillLabel(label: string): string {
  return label.replace(/Codex(?! CLI)/g, "AI");
}
export function parseSkill(file: SkillFile): CodexSkill {
  const blank: SkillConfig = { label: file.id, enabled: false, targets: [], inputs: ["text"], mode: "question", contextMenu: false, blockMenu: false, order: 100 };
  try {
    const match = file.source.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)([\s\S]*)$/);
    if (!match || file.source.length > 131072) throw new Error("SKILL.mdの先頭にYAMLの属性と本文を指定してください。");
    const data = parse(match[1], { maxAliasCount: 20 });
    if (!data || typeof data.name !== "string" || typeof data.description !== "string" || !match[2].trim()) throw new Error("name、description、プロンプト本文が必要です。");
    const c = data.metadata?.mdvisualizer;
    const validTargets = (value: unknown) => value === undefined || (Array.isArray(value) && value.every((v: unknown) => SKILL_TARGETS.includes(v as SkillTarget)));
    if (c && (typeof c !== "object" || !validTargets(c.targets) || !validTargets(c.contextTargets) || !validTargets(c.blockTargets) || (c.inputs !== undefined && (!Array.isArray(c.inputs) || c.inputs.some((v: unknown) => v !== "text" && v !== "image"))))) throw new Error("対象または入力の属性が不正です。");
    const label = typeof c?.label === "string" ? c.label : data.description;
    return { ...file, name: data.name, description: data.description, prompt: match[2].trim(), config: { ...blank, label: displaySkillLabel(label), enabled: c?.enabled === true, targets: c?.targets ?? [], inputs: c?.inputs ?? ["text"], mode: c?.mode === "selection" ? "selection" : "question", contextMenu: c?.contextMenu === true, blockMenu: c?.blockMenu === true, contextTargets: c?.contextTargets, blockTargets: c?.blockTargets, order: Number.isFinite(c?.order) ? c.order : 100 } };
  } catch (e) { return { ...file, name: file.id, description: "読み込みエラー", prompt: "", config: blank, error: String(e) }; }
}
export function updateSkillConfig(skill: CodexSkill, config: SkillConfig): string {
  const match = skill.source.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)([\s\S]*)$/);
  const data = match ? parse(match[1], { maxAliasCount: 20 }) : { name: skill.id, description: skill.description };
  return `---\n${stringify({ ...data, metadata: { ...data.metadata, mdvisualizer: config } })}---\n\n${match?.[2].trim() ?? skill.prompt}\n`;
}
export function visibleSkills(skills: CodexSkill[], target: SkillTarget, place: "contextMenu" | "blockMenu") {
  if (place === "blockMenu" && (target === "text" || target === "image")) return [];
  return skills.filter((s) => !s.error && s.config.enabled && s.config.targets.includes(target)
    && (place === "contextMenu"
      ? (s.config.contextTargets ?? (s.config.contextMenu ? s.config.targets : [])).includes(target)
      : (s.config.blockTargets ?? (s.config.blockMenu ? s.config.targets : [])).includes(target)))
    .sort((a, b) => a.config.order - b.config.order || a.id.localeCompare(b.id));
}
let snapshot = DEFAULT_SKILL_FILES.map(parseSkill);
let directory = "";
let requested = false;
const listeners = new Set<() => void>();
function publish(files: SkillFiles) { directory = files.directory; snapshot = files.files.map(parseSkill); listeners.forEach((listener) => listener()); }
export async function reloadSkills(): Promise<SkillFiles> { const files = await invoke<SkillFiles>("codex_list_skills"); if (files?.files) publish(files); return files; }
export async function saveSkillFile(id: string, source: string) { const skill = parseSkill({ id, source }); if (skill.error) throw new Error(skill.error); await invoke("codex_save_skill", { id, source }); await reloadSkills(); }
export async function deleteSkillFile(id: string) { await invoke("codex_delete_skill", { id }); await reloadSkills(); }
export function skillDirectory() { return directory; }
export function useCodexSkills() {
  const value = useSyncExternalStore((listener) => { listeners.add(listener); return () => { listeners.delete(listener); }; }, () => snapshot);
  useEffect(() => { if (!requested) { requested = true; void reloadSkills().catch(() => {}); } }, []);
  return value;
}
