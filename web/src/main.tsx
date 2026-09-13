import { createRoot } from "react-dom/client";
import "../../src/styles/app.css";
import "./web.css";
import "../../src/styles/content.css";
import "../../src/styles/themes.css";
import "../../src/styles/syntax-highlight.css";
import "../../src/styles/markdown-editor.css";
import "../../src/styles/delimited-table.css";
import "../../src/styles/drawio.css";
import "../../src/styles/document-diff.css";
import "../../src/styles/presentation.css";
import "../../src/styles/html-export.css";
import "../../src/styles/image-annotation.css";
import "../../src/styles/inline-image-resize.css";
import "../../src/styles/preview-inline-edit.css";
import { WebApp } from "./WebApp";
import { BrowserCapabilitiesContext } from "../../src/components/BrowserCapabilities";

createRoot(document.getElementById("root")!).render(
  <BrowserCapabilitiesContext.Provider value={{ canRunPowerShell: false, canOpenContainingFolder: false, canCopyBitmap: false, canUseCodexActions: false }}>
    <WebApp />
  </BrowserCapabilitiesContext.Provider>,
);
