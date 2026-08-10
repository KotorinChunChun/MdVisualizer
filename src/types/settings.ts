export type ExternalAppPlacement = "primary" | "menu";
export type ExternalAppTarget = "document" | "image";
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
  /** Omitted in pre-v0.0.4 settings; those entries are migrated to document apps. */
  target: ExternalAppTarget;
  builtinKind?: BuiltinExternalKind;
}

export interface SharePointSettings {
  clientId: string;
  tenant: string;
}

export const DEFAULT_SHAREPOINT_SETTINGS: SharePointSettings = {
  clientId: "",
  tenant: "organizations",
};

export function normalizeSharePointSettings(value: unknown): SharePointSettings {
  if (!value || typeof value !== "object") return { ...DEFAULT_SHAREPOINT_SETTINGS };
  const candidate = value as Partial<SharePointSettings>;
  return {
    clientId: typeof candidate.clientId === "string" ? candidate.clientId.trim() : "",
    tenant: typeof candidate.tenant === "string" && candidate.tenant.trim() ? candidate.tenant.trim() : "organizations",
  };
}

export function validateSharePointSettings(value: SharePointSettings): string | null {
  if (value.clientId && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value.clientId.trim())) {
    return "SharePointのクライアントIDはGUID形式で入力してください。";
  }
  if (!/^(?:organizations|common|[0-9a-f]{8}-[0-9a-f-]{27}|[a-z0-9.-]+\.[a-z0-9.-]+)$/i.test(value.tenant.trim())) {
    return "SharePointのテナント指定が正しくありません。";
  }
  return null;
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
    target: "document",
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
    target: "document",
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
    target: "document",
    builtinKind: "notepad",
  },
  {
    id: "default-image-paint",
    label: "ペイント",
    executable: "mspaint.exe",
    args: ["${file}"],
    workingDirectory: "${dir}",
    enabled: true,
    placement: "primary",
    order: 3,
    target: "image",
  },
];

export const DEFAULT_PRESENTATION_LINE_THRESHOLD = 10;
export const DEFAULT_IMAGE_A4_TARGET_WIDTH = 3508;
export const DEFAULT_IMAGE_EQUAL_PADDING = 32;

export function normalizePresentationLineThreshold(value: unknown): number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 100
    ? value
    : DEFAULT_PRESENTATION_LINE_THRESHOLD;
}

export function normalizeImageA4TargetWidth(value: unknown): number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1
    ? value
    : DEFAULT_IMAGE_A4_TARGET_WIDTH;
}

export function normalizeImageEqualPadding(value: unknown): number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0
    ? value
    : DEFAULT_IMAGE_EQUAL_PADDING;
}

function isPlacement(value: unknown): value is ExternalAppPlacement {
  return value === "primary" || value === "menu";
}

function isTarget(value: unknown): value is ExternalAppTarget {
  return value === "document" || value === "image";
}

export function normalizeExternalApps(value: unknown): ExternalAppConfig[] {
  if (!Array.isArray(value)) return DEFAULT_EXTERNAL_APPS.map((app) => ({ ...app, args: [...app.args] }));
  const needsTargetMigration = !value.some((item) => item && typeof item === "object" && isTarget((item as Partial<ExternalAppConfig>).target));
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
      target: isTarget(candidate.target) ? candidate.target : "document",
      builtinKind,
    }];
  });
  if (!apps.some((app) => app.builtinKind === "folder")) {
    const folder = DEFAULT_EXTERNAL_APPS.find((app) => app.builtinKind === "folder")!;
    apps.push({ ...folder, args: [...folder.args] });
  }
  if (needsTargetMigration && !apps.some((app) => app.id === "default-image-paint")) {
    const paint = DEFAULT_EXTERNAL_APPS.find((app) => app.id === "default-image-paint")!;
    apps.push({ ...paint, args: [...paint.args] });
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
