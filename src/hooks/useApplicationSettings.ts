import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { loadMarkdownStyle, loadSettingsStatus, openMarkdownStyle, saveMarkdownStyle, saveSettings, updateExternalAppSettings, type MarkdownStyleFile } from "../lib/commands";
import { DEFAULT_MARKDOWN_STYLE_SETTINGS, generateMarkdownStyleCss, normalizeMarkdownStyleSettings, validateMarkdownStyleCss, type MarkdownStyleSettings } from "../lib/markdownStyle";
import { applyPrintStyleSettings, DEFAULT_PRINT_STYLE_SETTINGS, needsPrintStyleSettingsMigration, normalizePrintStyleSettings, type PrintStyleSettings } from "../lib/printStyle";
import { applySyntaxHighlightSettings, DEFAULT_SYNTAX_HIGHLIGHT_SETTINGS, normalizeSyntaxHighlightSettings, type SyntaxHighlightSettings } from "../lib/syntaxHighlight";
import { normalizeDocumentViewModes, type ViewMode } from "../lib/viewMode";
import { normalizeZoom } from "../lib/zoom";
import type { ToastState } from "../types/app";
import { DEFAULT_CODE_BLOCK_FOLD_MIN_LINES, normalizeCodeBlockFoldMinLines } from "../lib/editorPreferences";
import {
  DEFAULT_EXTERNAL_APPS,
  DEFAULT_CLIPBOARD_IMAGE_SETTINGS,
  DEFAULT_IMAGE_A4_TARGET_WIDTH,
  DEFAULT_IMAGE_EQUAL_PADDING,
  DEFAULT_PRESENTATION_LINE_THRESHOLD,
  normalizeExternalApps,
  normalizeClipboardImageSettings,
  normalizeImageA4TargetWidth,
  normalizeImageEqualPadding,
  normalizePresentationLineThreshold,
  DEFAULT_EMBEDDED_PATH_STYLE,
  normalizeEmbeddedPathStyle,
  type EmbeddedPathStyle,
  type ExternalAppConfig,
  type ClipboardImageSettings,
} from "../types/settings";

export type AutoReloadSetting = "on" | "off" | "manual";

export function useApplicationSettings(setToast: Dispatch<SetStateAction<ToastState | null>>) {
  const [theme, setTheme] = useState("system");
  const [zoom, setZoom] = useState(100);
  const [documentViewModes, setDocumentViewModes] = useState<Record<string, ViewMode>>({});
  const [autoReload, setAutoReload] = useState<AutoReloadSetting>("on");
  const [foldStates, setFoldStates] = useState<Record<string, Record<string, boolean>>>({});
  const [externalApps, setExternalApps] = useState<ExternalAppConfig[]>(DEFAULT_EXTERNAL_APPS);
  const [presentationLineThreshold, setPresentationLineThreshold] = useState(DEFAULT_PRESENTATION_LINE_THRESHOLD);
  const [codeBlockFoldMinLines, setCodeBlockFoldMinLines] = useState(DEFAULT_CODE_BLOCK_FOLD_MIN_LINES);
  const [imageA4TargetWidth, setImageA4TargetWidth] = useState(DEFAULT_IMAGE_A4_TARGET_WIDTH);
  const [imageEqualPadding, setImageEqualPadding] = useState(DEFAULT_IMAGE_EQUAL_PADDING);
  const [clipboardImage, setClipboardImage] = useState<ClipboardImageSettings>(DEFAULT_CLIPBOARD_IMAGE_SETTINGS);
  const [embeddedPathStyle, setEmbeddedPathStyle] = useState<EmbeddedPathStyle>(DEFAULT_EMBEDDED_PATH_STYLE);
  const [syntaxHighlight, setSyntaxHighlight] = useState<SyntaxHighlightSettings>(DEFAULT_SYNTAX_HIGHLIGHT_SETTINGS);
  const [printStyle, setPrintStyle] = useState<PrintStyleSettings>(DEFAULT_PRINT_STYLE_SETTINGS);
  const [markdownStyle, setMarkdownStyle] = useState<MarkdownStyleSettings>(DEFAULT_MARKDOWN_STYLE_SETTINGS);
  const [markdownStyleCss, setMarkdownStyleCss] = useState(() => generateMarkdownStyleCss(DEFAULT_MARKDOWN_STYLE_SETTINGS));
  const [markdownStylePath, setMarkdownStylePath] = useState("");
  const themeRef = useRef(theme);
  const zoomRef = useRef(zoom);
  const autoReloadRef = useRef(autoReload);
  const markdownStyleRevisionRef = useRef("");

  const acceptMarkdownStyleFile = useCallback((file: MarkdownStyleFile, reportInvalid = true) => {
    const invalid = validateMarkdownStyleCss(file.css);
    if (invalid) {
      markdownStyleRevisionRef.current = file.revision;
      if (reportInvalid) setToast({ id: String(Date.now()), message: `Markdown CSSを適用できません: ${invalid}`, type: "error" });
      return false;
    }
    markdownStyleRevisionRef.current = file.revision;
    setMarkdownStyleCss(file.css);
    setMarkdownStylePath(file.path);
    return true;
  }, [setToast]);

  const persistSetting = useCallback((key: "theme" | "zoom" | "autoReload", value: string | number) => {
    void saveSettings({ [key]: value }).catch((error) => {
      setToast({ id: String(Date.now()), message: `設定の保存に失敗しました: ${String(error)}`, type: "error" });
    });
  }, [setToast]);

  const updateTheme = useCallback((value: string) => {
    if (themeRef.current === value) return;
    themeRef.current = value;
    setTheme(value);
    persistSetting("theme", value);
  }, [persistSetting]);

  const updateZoom = useCallback((value: number | ((current: number) => number)) => {
    const requested = typeof value === "function" ? value(zoomRef.current) : value;
    const next = normalizeZoom(requested);
    if (zoomRef.current === next) return;
    zoomRef.current = next;
    setZoom(next);
    persistSetting("zoom", next);
  }, [persistSetting]);

  const updateAutoReload = useCallback((value: AutoReloadSetting) => {
    if (autoReloadRef.current === value) return;
    autoReloadRef.current = value;
    setAutoReload(value);
    persistSetting("autoReload", value);
  }, [persistSetting]);

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const applyTheme = () => {
      document.documentElement.dataset.theme = theme === "system" ? (media.matches ? "dark" : "light") : theme;
    };
    applyTheme();
    media.addEventListener("change", applyTheme);
    return () => media.removeEventListener("change", applyTheme);
  }, [theme]);

  useEffect(() => {
    applySyntaxHighlightSettings(document.documentElement, syntaxHighlight);
  }, [syntaxHighlight]);

  useEffect(() => {
    applyPrintStyleSettings(document.documentElement, printStyle);
  }, [printStyle]);

  useEffect(() => {
    void loadSettingsStatus().then(({ settings, recoveredFiles }) => {
      if (typeof settings.theme === "string") {
        themeRef.current = settings.theme;
        setTheme(settings.theme);
      }
      if (typeof settings.zoom === "number") {
        const value = normalizeZoom(settings.zoom);
        zoomRef.current = value;
        setZoom(value);
      }
      const normalizedDocumentViewModes = normalizeDocumentViewModes(settings.documentViewModes);
      setDocumentViewModes(normalizedDocumentViewModes);
      if (["on", "off", "manual"].includes(String(settings.autoReload))) {
        const value = settings.autoReload as AutoReloadSetting;
        autoReloadRef.current = value;
        setAutoReload(value);
      } else if (typeof settings.autoReload === "boolean") {
        const value = settings.autoReload ? "on" : "off";
        autoReloadRef.current = value;
        setAutoReload(value);
      }
      if (settings.foldStates && typeof settings.foldStates === "object") {
        setFoldStates(settings.foldStates as Record<string, Record<string, boolean>>);
      }
      const apps = normalizeExternalApps(settings.externalApps);
      const lineThreshold = normalizePresentationLineThreshold(settings.presentationLineThreshold);
      const a4TargetWidth = normalizeImageA4TargetWidth(settings.imageA4TargetWidth);
      const equalPadding = normalizeImageEqualPadding(settings.imageEqualPadding);
      const normalizedClipboardImage = normalizeClipboardImageSettings(settings.clipboardImage);
      const normalizedEmbeddedPathStyle = normalizeEmbeddedPathStyle(settings.embeddedPathStyle);
      const normalizedSyntaxHighlight = normalizeSyntaxHighlightSettings(settings.syntaxHighlight);
      const normalizedPrintStyle = normalizePrintStyleSettings(settings.printStyle);
      const normalizedMarkdownStyle = normalizeMarkdownStyleSettings(settings.markdownStyle);
      setExternalApps(apps);
      setPresentationLineThreshold(lineThreshold);
      setCodeBlockFoldMinLines(normalizeCodeBlockFoldMinLines(settings.codeBlockFoldMinLines));
      setImageA4TargetWidth(a4TargetWidth);
      setImageEqualPadding(equalPadding);
      setClipboardImage(normalizedClipboardImage);
      setEmbeddedPathStyle(normalizedEmbeddedPathStyle);
      setSyntaxHighlight(normalizedSyntaxHighlight);
      setPrintStyle(normalizedPrintStyle);
      setMarkdownStyle(normalizedMarkdownStyle);
      void loadMarkdownStyle(generateMarkdownStyleCss(normalizedMarkdownStyle))
        .then((file) => acceptMarkdownStyleFile(file))
        .catch((error) => setToast({ id: String(Date.now()), message: `Markdown CSSの読込に失敗しました: ${String(error)}`, type: "error" }));

      const needsSettingsMigration = !Array.isArray(settings.externalApps)
        || settings.externalApps.some((app) => !app || typeof app !== "object" || !("target" in app))
        || settings.imageA4TargetWidth === undefined
        || settings.imageEqualPadding === undefined
        || settings.clipboardImage === undefined
        || settings.syntaxHighlight === undefined
        || needsPrintStyleSettingsMigration(settings.printStyle)
        || settings.markdownStyle === undefined
        || settings.embeddedPathStyle === undefined
        || JSON.stringify(settings.documentViewModes) !== JSON.stringify(normalizedDocumentViewModes);
      if (needsSettingsMigration) {
        void saveSettings({
          schemaVersion: 8,
          externalApps: apps,
          presentationLineThreshold: lineThreshold,
          imageA4TargetWidth: a4TargetWidth,
          imageEqualPadding: equalPadding,
          clipboardImage: normalizedClipboardImage,
          embeddedPathStyle: normalizedEmbeddedPathStyle,
          syntaxHighlight: normalizedSyntaxHighlight,
          printStyle: normalizedPrintStyle,
          markdownStyle: normalizedMarkdownStyle,
          documentViewModes: normalizedDocumentViewModes,
        }).catch((error) => {
          setToast({ id: String(Date.now()), message: `外部アプリ設定の移行に失敗しました: ${String(error)}`, type: "error" });
        });
      }
      if (recoveredFiles.length > 0) {
        setToast({
          id: String(Date.now()),
          message: `破損した設定ファイルを退避し、初期設定で起動しました（${recoveredFiles.length}件）`,
          type: "info",
        });
      }
    }).catch((error) => {
      setToast({ id: String(Date.now()), message: `設定の読込に失敗しました: ${String(error)}`, type: "error" });
    });
  }, [acceptMarkdownStyleFile, setToast]);

  useEffect(() => {
    if (!markdownStylePath) return;
    const timer = window.setInterval(() => {
      void loadMarkdownStyle(generateMarkdownStyleCss(markdownStyle)).then((file) => {
        if (file.revision !== markdownStyleRevisionRef.current) acceptMarkdownStyleFile(file);
      }).catch(() => {
        // A transient read failure must keep the last valid CSS active.
      });
    }, 1_000);
    return () => window.clearInterval(timer);
  }, [acceptMarkdownStyleFile, markdownStyle, markdownStylePath]);

  const saveExternalAppSettings = useCallback(async (
    apps: ExternalAppConfig[],
    lineThreshold: number,
    a4TargetWidth: number,
    equalPadding: number,
    nextSyntaxHighlight: SyntaxHighlightSettings,
    nextPrintStyle: PrintStyleSettings,
    nextMarkdownStyle: MarkdownStyleSettings,
    nextClipboardImage: ClipboardImageSettings,
    nextEmbeddedPathStyle: EmbeddedPathStyle,
    nextCodeBlockFoldMinLines: number = DEFAULT_CODE_BLOCK_FOLD_MIN_LINES,
  ) => {
    try {
      const previousById = new Map(externalApps.map((app) => [app.id, app]));
      const upserts = apps.filter((app) => JSON.stringify(previousById.get(app.id)) !== JSON.stringify(app));
      const nextIds = new Set(apps.map((app) => app.id));
      const removedIds = externalApps.filter((app) => !nextIds.has(app.id)).map((app) => app.id);
      const saved = await updateExternalAppSettings(upserts, removedIds, lineThreshold, a4TargetWidth, equalPadding);
      const normalizedSyntaxHighlight = normalizeSyntaxHighlightSettings(nextSyntaxHighlight);
      const normalizedPrintStyle = normalizePrintStyleSettings(nextPrintStyle);
      const normalizedMarkdownStyle = normalizeMarkdownStyleSettings(nextMarkdownStyle);
      const normalizedClipboardImage = normalizeClipboardImageSettings(nextClipboardImage);
      const normalizedEmbeddedPathStyle = normalizeEmbeddedPathStyle(nextEmbeddedPathStyle);
      const styleFile = await saveMarkdownStyle(generateMarkdownStyleCss(normalizedMarkdownStyle));
      const foldMinLines = normalizeCodeBlockFoldMinLines(nextCodeBlockFoldMinLines);
      await saveSettings({ syntaxHighlight: normalizedSyntaxHighlight, printStyle: normalizedPrintStyle, markdownStyle: normalizedMarkdownStyle, clipboardImage: normalizedClipboardImage, embeddedPathStyle: normalizedEmbeddedPathStyle, codeBlockFoldMinLines: foldMinLines });
      setCodeBlockFoldMinLines(foldMinLines);
      setExternalApps(normalizeExternalApps(saved.externalApps));
      setPresentationLineThreshold(lineThreshold);
      setImageA4TargetWidth(a4TargetWidth);
      setImageEqualPadding(equalPadding);
      setSyntaxHighlight(normalizedSyntaxHighlight);
      setPrintStyle(normalizedPrintStyle);
      setMarkdownStyle(normalizedMarkdownStyle);
      setClipboardImage(normalizedClipboardImage);
      setEmbeddedPathStyle(normalizedEmbeddedPathStyle);
      acceptMarkdownStyleFile(styleFile);
      setToast({ id: String(Date.now()), message: "設定を保存しました", type: "success" });
    } catch (error) {
      setToast({ id: String(Date.now()), message: `設定の保存に失敗しました: ${String(error)}`, type: "error" });
      throw error;
    }
  }, [acceptMarkdownStyleFile, externalApps, setToast]);

  const reloadMarkdownStyle = useCallback(async () => {
    const file = await loadMarkdownStyle(generateMarkdownStyleCss(markdownStyle));
    if (!acceptMarkdownStyleFile(file)) throw new Error("Markdown CSSが不正です。");
  }, [acceptMarkdownStyleFile, markdownStyle]);

  const openMarkdownStyleFile = useCallback(async () => {
    await openMarkdownStyle();
  }, []);

  return {
    theme,
    zoom,
    documentViewModes,
    setDocumentViewModes,
    autoReload,
    foldStates,
    setFoldStates,
    externalApps,
    presentationLineThreshold,
    codeBlockFoldMinLines,
    imageA4TargetWidth,
    imageEqualPadding,
    clipboardImage,
    embeddedPathStyle,
    syntaxHighlight,
    printStyle,
    markdownStyle,
    markdownStyleCss,
    markdownStylePath,
    updateTheme,
    updateZoom,
    updateAutoReload,
    saveExternalAppSettings,
    reloadMarkdownStyle,
    openMarkdownStyleFile,
  };
}
