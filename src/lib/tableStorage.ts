import type { CodeFenceOccurrence, ImageMarkdownOccurrence } from "./markdownOccurrences";
import type { DelimitedTableLanguage } from "./delimitedTable";

export interface TableStorageConversionContext {
  documentPath: string;
  storage: "embedded" | "external";
  occurrence: CodeFenceOccurrence | ImageMarkdownOccurrence;
  source: string;
  language: DelimitedTableLanguage;
  relativePath?: string;
}
