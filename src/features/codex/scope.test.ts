import { describe, expect, it } from "vitest";
import { captionReplacement, resolveOperationTarget, scopeRequest, targetAtLine } from "./scope";

describe("Codex相談の対象範囲", () => {
  it("同じ行の同じ画像でもクリックした出現箇所を区別する", () => {
    const content = "![a](same.png) ![a](same.png)";
    expect(resolveOperationTarget(content, { sourceLine: 1 })).toBeNull();
    const second = resolveOperationTarget(content, { occurrenceId: 'markdown-image-15' })!;
    expect(second.from).toBe(15);
    expect(captionReplacement({ ...second, documentId: 'doc' }, '説明 [a]')).toBe('![説明 \\[a\\]](same.png)');
    expect(content.slice(0, second.from)).toBe('![a](same.png) ');
  });
  it("フェンス内の画像記法はコードであり画像変換・キャプション対象にしない", () => {
    const content = "```md\n![fake](image.png)\n```\n\n![real](image.png)";
    const code = resolveOperationTarget(content, { offset: 8 })!;
    expect(code.targetKind).toBe('code'); expect(code.storage).toBe('embedded');
    expect(code.occurrence?.kind).toBe('code-fence'); expect(code.imageSource).toBeUndefined();
    expect(() => captionReplacement({ ...code, documentId:'doc' }, '説明')).toThrow();
    expect(resolveOperationTarget(content,{offset:content.lastIndexOf('![')})?.targetKind).toBe('image');
  });
  it.each([
    ['![旧 \\](説明)](old.png "title")', '説明', '![説明](old.png "title")'],
    ['![[folder/old.png|旧説明]]', '新説明', '![[folder/old.png|新説明]]'],
    ['[[folder/old.png]]', '新説明', '[[folder/old.png|新説明]]'],
    ['![[folder/old.png|旧説明]]', '新[説明]', '![新\\[説明\\]](folder/old.png)'],
    ['![[folder/old.png]]', '120', '![120](folder/old.png)'],
    ['<img src="old.png" alt="旧説明">', '$& <説明>', '<img src="old.png" alt="$&amp; &lt;説明&gt;">'],
  ])("%sの説明文だけを変更し参照を維持する", (content, caption, expected) => {
    const target = resolveOperationTarget(content, { offset: 1 })!;
    const replacement = captionReplacement({ ...target, documentId: 'doc' }, caption);
    expect(replacement).toBe(expected);
    const changed = resolveOperationTarget(replacement, { offset: 1 })!;
    expect(changed.imageSource).toBe(target.imageSource);
    const renderedCaption = document.createElement('textarea');
    renderedCaption.innerHTML = changed.caption ?? '';
    expect(renderedCaption.value).toBe(caption);
  });
  it("埋め込みと外部の図、名前付きコードフェンスを共通判定する", () => {
    expect(resolveOperationTarget('![](a.mmd)',{offset:2})?.targetKind).toBe('mermaid');
    expect(resolveOperationTarget('![](a.drawio)',{offset:2})?.targetKind).toBe('drawio');
    expect(resolveOperationTarget('![](data:image/png;base64,AAAA)',{offset:2})?.storage).toBe('embedded');
    expect(resolveOperationTarget('```python title="code/x.py"\nx=1\n```',{offset:29})).toMatchObject({targetKind:'code',imageSource:'code/x.py',language:'python'});
  });
  const content = "前の文章\n\n```mermaid\nflowchart TD\nA --> B\n```\n\n後の文章";
  it("Mermaidのフェンスを含む指定ブロックだけを取得する", () => {
    const target = targetAtLine(content, 4)!;
    expect(content.slice(target.from, target.to)).toBe("```mermaid\nflowchart TD\nA --> B\n```");
  });
  it("段落内の明示選択だけを対象にし、曖昧な一致は推測しない", () => {
    expect(targetAtLine("前の文章", 1, "文章")).toEqual({ from: 2, to: 4 });
    expect(targetAtLine("同じ 同じ", 1, "同じ")).toBeNull();
    expect(targetAtLine("**太字**", 1, "別の文")).toBeNull();
  });
  it("画像の記法と添付元を特定する", () => {
    expect(targetAtLine("![図](test.png)", 1, "", true)).toEqual({ from: 0, to: 14, imageSource: "test.png" });
  });
  it("限定編集は前後を含めず、広域編集だけ文書全体を送る", () => {
    const snapshot = { documentId: "doc", content, from: 0, to: 0 };
    const target = { ...snapshot, ...targetAtLine(content, 4)! };
    expect(scopeRequest(snapshot, target, "selection", "直して").text).toBe(content.slice(target.from, target.to));
    const broad = scopeRequest(snapshot, target, "document", "直して");
    expect(broad.base).toEqual({ ...snapshot, to: content.length });
    expect(broad.text).toBe(content);
    expect(broad.instruction).toContain("別ファイルの編集は許可されていません");
    expect(scopeRequest(snapshot, target, "question", "説明して").instruction).toContain("replacementは必ずnull");
  });
});
