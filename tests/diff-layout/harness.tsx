import { useLayoutEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { EditorView } from "@codemirror/view";
import { DocumentDiffWorkspace, type DiffSaveReview } from "../../src/components/DocumentDiffWorkspace";
import type { EditorWorkspaceMode } from "../../src/state/tabsReducer";
import "../../src/styles/app.css";
import "./harness.css";

const base = Array.from({ length: 140 }, (_, i) => i === 4 ? "# 見出し **太字** *斜体*" : i === 6 ? "\t日本語\tcode" : `line ${i + 1}`).join("\n");
const local = base.replace("line 2", "local 2").replace("line 10\n", "").replace("line 16", "local追加\nline 16");
const storage = base.replace("line 2", "storage 2").replace("line 9\n", "").replace("line 25", "storage追加\nline 25")
  .replace("line 31", "storage31 日本語".repeat(45));
interface Options { threeWay: boolean; mode: EditorWorkspaceMode; theme: string; empty?: boolean }
interface TestApi {
  reset: (options: Options) => void; external: () => void; edit: (text: string) => void;
  state: () => { content: string; review: DiffSaveReview | null; saves: number };
}
declare global { interface Window { diffTest: TestApi } }
function Harness() {
  const [options, setOptions] = useState<Options>({ threeWay: false, mode: "edit", theme: "dark" });
  const [content, setContent] = useState(local);
  const [generation, setGeneration] = useState(0);
  const [saves, setSaves] = useState(0);
  const [review, setReview] = useState<DiffSaveReview | null>(null);
  useLayoutEffect(() => {
    document.documentElement.dataset.theme = options.theme;
    window.diffTest = {
      reset: (next) => { setOptions(next); setContent(next.empty ? "自分" : local); setGeneration((value) => value + 1); setSaves(0); },
      external: () => setOptions((value) => ({ ...value, threeWay: true })),
      edit: (text) => { const view = EditorView.findFromDOM(document.querySelector('[data-pane-key="result"] .cm-editor')!)!;
        view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text } }); },
      state: () => ({ content, review, saves }),
    };
  });
  return <DocumentDiffWorkspace key={generation} target={{ path: "C:/fixture.md", baseDir: "C:/", baselineRevision: "r1",
    storageRevision: options.threeWay ? "r2" : "r1", openedContent: options.empty ? "" : base,
    storageContent: options.threeWay ? options.empty ? "追加\n" : storage : options.empty ? "" : base,
    editingContent: content }} editorMode={options.mode} theme={options.theme} onEditingChange={setContent}
    onReviewChange={setReview} onSave={() => setSaves((value) => value + 1)} />;
}
createRoot(document.getElementById("root")!).render(<Harness />);
