import type { MarkdownLoadResult } from "../types/app";
import { documentSourceIdentity } from "./pathIdentity";

export interface UntitledSaveRequest {
  defaultPath: string;
  content: string;
  openDocumentPaths: readonly string[];
}

export interface UntitledSaveDependencies {
  choosePath: (defaultPath: string) => Promise<string | null>;
  createDocument: (path: string, content: string) => Promise<MarkdownLoadResult>;
}

export type UntitledSaveResult =
  | { status: "cancelled" }
  | { status: "saved"; path: string; document: MarkdownLoadResult };

export async function saveUntitledDocument(
  request: UntitledSaveRequest,
  dependencies: UntitledSaveDependencies,
): Promise<UntitledSaveResult> {
  const path = await dependencies.choosePath(request.defaultPath);
  if (!path) return { status: "cancelled" };
  const identity = documentSourceIdentity(path);
  if (request.openDocumentPaths.some((candidate) => documentSourceIdentity(candidate) === identity)) {
    throw new Error("指定したMarkdownは既に別のタブで開かれています。");
  }
  const document = await dependencies.createDocument(path, request.content);
  return { status: "saved", path, document };
}
