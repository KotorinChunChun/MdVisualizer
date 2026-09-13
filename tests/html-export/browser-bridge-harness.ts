import { exportHtmlInBrowser, type HtmlExportOptions } from '../../src/lib/htmlExport';

declare global { interface Window { runHtmlExport: (options: HtmlExportOptions) => ReturnType<typeof exportHtmlInBrowser> } }

window.runHtmlExport = exportHtmlInBrowser;
