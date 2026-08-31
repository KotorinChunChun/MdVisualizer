import { useState } from "react";
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useDocumentMerge } from "./useDocumentMerge";

describe("比較不能時の編集保護", () => {
  it("計算上限を超えても本文を編集できるが、空の行対応を成功扱いにしない", () => {
    const openedContent = Array.from({ length: 800 }, (_, i) => `base${i}`).join("\n");
    const storageContent = Array.from({ length: 800 }, (_, i) => `external${i}`).join("\n");
    const { result } = renderHook(() => {
      const [editingContent, setContent] = useState("自分の原文");
      return { editingContent, merge: useDocumentMerge({ path: "C:/a.md", baseDir: "C:/", openedContent, storageContent, editingContent }, setContent) };
    });
    expect(result.current.merge.error).toContain("差分が多すぎる");
    act(() => result.current.merge.edit("手入力は保持"));
    expect(result.current.editingContent).toBe("手入力は保持");
    expect(result.current.merge.error).toContain("差分が多すぎる");
    expect(result.current.merge.rows).toEqual([]);
    act(() => result.current.merge.undo());
    expect(result.current.editingContent).toBe("自分の原文");
    expect(result.current.merge.error).toBeTruthy();
  });
});
