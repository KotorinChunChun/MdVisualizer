import { useEffect, useRef } from "react";
import { createRoot } from "react-dom/client";
import { MarkdownPreview } from "../../src/components/MarkdownPreview";
import { PresentationView } from "../../src/components/PresentationView";
import { DelimitedTableBlock } from "../../src/components/DelimitedTableBlock";
import { PrintMetadata } from "../../src/components/PrintMetadata";
import { useDocumentPrint } from "../../src/hooks/useDocumentPrint";
import { applyPrintStyleSettings, DEFAULT_PRINT_STYLE_SETTINGS } from "../../src/lib/printStyle";
import { getMermaidStatus } from "../../src/lib/mermaidStatus";
import { slugifyHeading } from "../../src/lib/headingIds";
import "../../src/styles/app.css";
import "../../src/styles/content.css";
import "../../src/styles/themes.css";
import "../../src/styles/syntax-highlight.css";

declare global {
  interface Window {
    createTestPdf: () => Promise<void>;
    printTest: {
      print: () => Promise<void>;
      state: () => unknown;
      ready: () => boolean;
    };
  }
}

const scenario = new URLSearchParams(location.search).get("case") ?? "normal";
const theme = scenario === "dark" ? "dark" : "light";
const isTable = scenario === "table";
const isPresentation = scenario === "presentation";
const settings = {
  ...DEFAULT_PRINT_STYLE_SETTINGS,
  foldMode: scenario === "fold-current" ? "current" as const : "all" as const,
  showTitle: scenario !== "metadata-off",
  showFilename: scenario !== "metadata-off",
  showDate: scenario !== "metadata-off",
};
const shortContent = `# 日本語の印刷確認

PDF_VISIBLE_TEXT 日本語の本文と改ページを確認します。

> 引用文の印刷を確認します。

| 品目 | 数量 |
| --- | --- |
| テスト | 42 |

\`\`\`typescript
const PDF_CODE_TOKEN = 42;
\`\`\`

\`\`\`mermaid
flowchart LR
  A[PDF_DIAGRAM_A] --> B[PDF_DIAGRAM_B]
\`\`\`

<svg xmlns="http://www.w3.org/2000/svg" width="240" height="60" viewBox="0 0 240 60"><rect x="2" y="2" width="236" height="56" fill="#dbeafe" stroke="#2563eb"/><text x="15" y="38" font-size="18">PDF_SVG_TOKEN</text></svg>
`;
const foldedContent = "# PDF_VISIBLE_TEXT\n\n表示中の本文。\n\n## 閉じた見出し\n\nPDF_FOLDED_BODY\n";
// 子見出しを持つ親ページはナビゲーション表示になるため、親はタイトルを検査する。
const presentationContent = "# PDF_SLIDE_ONE\n\n## Slide Two\n\nPDF_SLIDE_TWO\n\n## Slide Three\n\nPDF_SLIDE_THREE\n";
const content = scenario.startsWith("fold-") ? foldedContent
  : scenario === "long" ? `# PDF_LONG_DOCUMENT\n\n${Array.from({ length: 100 }, (_, i) => `PDF_PARAGRAPH_${String(i + 1).padStart(3, "0")} 日本語を含む長い文書の連続ページを検査します。`).join("\n\n")}`
  : shortContent;
const foldState = scenario.startsWith("fold-") ? { [slugifyHeading("閉じた見出し")]: true } : {};
const tableSource = ["name,score,secret", ...Array.from({ length: 60 }, (_, i) => `KEEP_ROW_${String(i + 1).padStart(3, "0")},${i + 1},PDF_HIDDEN_COLUMN`), "DROP_ROW,999,PDF_HIDDEN_COLUMN", "合計,,"].join("\n");
const messages: string[] = [];
const error = (message: string) => messages.push(message);
const pdfDevice = () => window.createTestPdf();

function Harness() {
  const viewport = useRef<HTMLElement>(null);
  const restoreCount = useRef(0);
  const { printing, printStartedAt, printDocument } = useDocumentPrint({
    getSnapshot: () => ({ scrollTop: viewport.current?.scrollTop ?? 0 }),
    restore: (snapshot) => { restoreCount.current++; if (viewport.current) viewport.current.scrollTop = snapshot.scrollTop; },
    print: pdfDevice, onInfo: error, onError: error,
  });
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    applyPrintStyleSettings(document.documentElement, settings);
  }, []);
  useEffect(() => {
    window.printTest = {
      ready: () => getMermaidStatus().pending === 0 && !document.querySelector(".mermaid-loading"),
      print: isTable ? async () => {
        // OS入力は送らず、隔離したheadless DOM内で製品の操作経路を呼ぶ。
        const first = document.querySelector(".data-grid-card")!;
        const button = [...first.querySelectorAll<HTMLButtonElement>("button")].find((candidate) => candidate.textContent === "印刷");
        if (!button) throw new Error("選択表の印刷ボタンがありません");
        button.click();
      } : printDocument,
      state: () => ({ printing, startedAt: printStartedAt, restoreCount: restoreCount.current, scrollTop: viewport.current?.scrollTop,
        printHosts: document.querySelectorAll(".table-print-host").length, tablePrinting: document.body.classList.contains("table-print-active"),
        collapsed: [...document.querySelectorAll(".fold-content")].filter((element) => element.hasAttribute("hidden")).length,
        messages: [...messages] }),
    };
  });
  return <div className={`app-container${printing ? " is-printing" : ""}`} data-print-fold-mode={settings.foldMode}>
    {printing && <PrintMetadata path="C:/print-fixtures/print-fixture.md" startedAt={printStartedAt} settings={settings} />}
    <div className="tab-bar">PDF_EXCLUDED_TAB_BAR</div>
    <div className="view-controls">PDF_EXCLUDED_TOOLBAR</div>
    <div className="document-workspace">
      <aside className="document-side-panel-root">PDF_EXCLUDED_SIDE_PANEL</aside>
      <main ref={viewport} className={`preview-container view-${isPresentation ? "presentation" : "auto"}`}>
        {isPresentation ? <PresentationView content={presentationContent} baseDir="" imageVersions={{}} theme={printing ? "light" : theme}
          mermaidMode="on" windowId="pdf" tabId="presentation" imageDisplaySizes={{}} lineThreshold={0} onError={error} />
          : isTable ? <>
            <p>PDF_EXCLUDED_OTHER_BODY</p>
            <DelimitedTableBlock language="csv" source={tableSource} printDevice={pdfDevice} />
            <DelimitedTableBlock language="csv" source={"other\nPDF_EXCLUDED_OTHER_TABLE"} printDevice={pdfDevice} />
          </> : <MarkdownPreview content={content} baseDir="" imageVersions={{}} theme={printing ? "light" : theme} windowId="pdf" tabId={scenario}
            foldState={foldState} onError={error} />}
      </main>
    </div>
    <div className="status-bar">PDF_EXCLUDED_STATUS_BAR</div>
  </div>;
}

createRoot(document.getElementById("root")!).render(<Harness />);
