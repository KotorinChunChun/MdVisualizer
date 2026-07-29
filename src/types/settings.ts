export type ExternalAppPlacement = "primary" | "menu";
export type BuiltinExternalKind = "folder" | "vscode" | "notepad";

export interface ExternalAppConfig {
  id: string;
  label: string;
  executable: string;
  args: string[];
  workingDirectory: string;
  enabled: boolean;
  placement: ExternalAppPlacement;
  order: number;
  builtinKind?: BuiltinExternalKind;
}

export const DEFAULT_EXTERNAL_APPS: ExternalAppConfig[] = [
  {
    id: "builtin-folder",
    label: "フォルダー",
    executable: "",
    args: [],
    workingDirectory: "",
    enabled: true,
    placement: "primary",
    order: 0,
    builtinKind: "folder",
  },
  {
    id: "builtin-vscode",
    label: "VS Code",
    executable: "",
    args: ["${file}"],
    workingDirectory: "${dir}",
    enabled: true,
    placement: "primary",
    order: 1,
    builtinKind: "vscode",
  },
  {
    id: "builtin-notepad",
    label: "メモ帳",
    executable: "",
    args: ["${file}"],
    workingDirectory: "${dir}",
    enabled: true,
    placement: "menu",
    order: 2,
    builtinKind: "notepad",
  },
];

export const DEFAULT_PRESENTATION_LINE_THRESHOLD = 10;

export function normalizePresentationLineThreshold(value: unknown): number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 100
    ? value
    : DEFAULT_PRESENTATION_LINE_THRESHOLD;
}

function isPlacement(value: unknown): value is ExternalAppPlacement {
  return value === "primary" || value === "menu";
}

export function normalizeExternalApps(value: unknown): ExternalAppConfig[] {
  if (!Array.isArray(value)) return DEFAULT_EXTERNAL_APPS.map((app) => ({ ...app, args: [...app.args] }));
  const apps = value.flatMap((item, index): ExternalAppConfig[] => {
    if (!item || typeof item !== "object") return [];
    const candidate = item as Partial<ExternalAppConfig>;
    if (typeof candidate.id !== "string" || typeof candidate.label !== "string") return [];
    const builtinKind = ["folder", "vscode", "notepad"].includes(String(candidate.builtinKind))
      ? candidate.builtinKind as BuiltinExternalKind
      : undefined;
    if (!builtinKind && typeof candidate.executable !== "string") return [];
    return [{
      id: candidate.id,
      label: candidate.label,
      executable: typeof candidate.executable === "string" ? candidate.executable : "",
      args: Array.isArray(candidate.args) ? candidate.args.filter((arg): arg is string => typeof arg === "string") : [],
      workingDirectory: typeof candidate.workingDirectory === "string" ? candidate.workingDirectory : "",
      enabled: candidate.enabled !== false,
      placement: isPlacement(candidate.placement) ? candidate.placement : "menu",
      order: Number.isFinite(candidate.order) ? Number(candidate.order) : index,
      builtinKind,
    }];
  });
  if (!apps.some((app) => app.builtinKind === "folder")) {
    const folder = DEFAULT_EXTERNAL_APPS.find((app) => app.builtinKind === "folder")!;
    apps.push({ ...folder, args: [...folder.args] });
  }
  return apps.sort((left, right) => left.order - right.order).map((app, order) => ({ ...app, order }));
}

export function validateExternalApp(app: ExternalAppConfig): string | null {
  if (!app.label.trim()) return "表示名を入力してください。";
  if (!app.builtinKind && !app.executable.trim()) return "実行ファイルを入力してください。";
  const values = [...app.args, app.workingDirectory];
  const placeholders = values.flatMap((value) => value.match(/\$\{[^}]+\}/g) ?? []);
  const invalid = placeholders.find((value) => !["${file}", "${dir}", "${line}"].includes(value));
  return invalid ? `未対応のプレースホルダーです: ${invalid}` : null;
}
