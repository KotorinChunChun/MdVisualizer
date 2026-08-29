import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { countMermaidFences, MarkdownPreview } from "./MarkdownPreview";
import { openExternalUrl } from "../lib/commands";

vi.mock("./ImageRenderer", () => ({
  ImageRenderer: ({ alt, headingMode }: { alt?: string; headingMode?: boolean }) => <span data-testid={`image-${alt}`} data-heading-mode={headingMode ? "true" : "false"} />,
}));
vi.mock("../lib/commands", () => ({ openExternalUrl: vi.fn(), runPowerShell: vi.fn() }));

describe("MarkdownPreview sanitization", () => {
  it("renders safe HTML and removes scripts, event handlers, and unsafe URLs", () => {
    const { container } = render(<MarkdownPreview content={'<strong>safe</strong><script>window.bad=true</script><a href="javascript:alert(1)" onclick="bad()">bad</a><a href="https://example.com">good</a>'} baseDir="" imageVersions={{}} />);
    expect(screen.getByText("safe").tagName).toBe("STRONG");
    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelector("[onclick]")).toBeNull();
    expect(screen.getByText("bad").getAttribute("href")).toBeNull();
    expect(screen.getByText("good").getAttribute("href")).toBe("https://example.com");
  });

  it("makes rendered headings collapsible with their preserved fold id", () => {
    render(<MarkdownPreview content={"# Heading\n\nBody"} baseDir="" imageVersions={{}} />);
    const button = screen.getByRole("button", { name: /Heading/ });
    expect(button.closest("section")?.dataset.foldId).toBe("heading");
    fireEvent.click(button);
    expect(button.getAttribute("aria-expanded")).toBe("false");
    expect(screen.getByText("Body").closest("section")?.querySelector(":scope > .fold-content")?.hasAttribute("hidden")).toBe(true);
  });

  it("marks only images inside headings for compact heading presentation", () => {
    render(<MarkdownPreview content={"# 見出し ![ロゴ](logo.png)\n\n本文 ![写真](photo.png)"} baseDir="" imageVersions={{}} />);
    expect(screen.getByTestId("image-ロゴ").dataset.headingMode).toBe("true");
    expect(screen.getByTestId("image-写真").dataset.headingMode).toBe("false");
  });

  it("renders nested block quotes and Markdown and HTML horizontal rules", () => {
    const { container } = render(<MarkdownPreview content={"> outer\n>\n> > inner\n\n---\n\n<hr>"} baseDir="" imageVersions={{}} />);

    expect(container.querySelectorAll("blockquote")).toHaveLength(2);
    expect(container.querySelector("blockquote blockquote")?.textContent).toContain("inner");
    expect(container.querySelectorAll("hr")).toHaveLength(2);
  });

  it("opens a relative Markdown link in the app instead of the external URL handler", () => {
    const onOpenDocument = vi.fn();
    render(<MarkdownPreview content="[next](../guide/next.md)" baseDir="C:\\docs\\current" imageVersions={{}} onOpenDocument={onOpenDocument} />);
    fireEvent.click(screen.getByRole("link", { name: "next" }));
    expect(onOpenDocument).toHaveBeenCalledWith("C:/docs/guide/next.md");
    expect(openExternalUrl).not.toHaveBeenCalled();
  });

  it("opens an Obsidian-style local Markdown wiki link in the app", () => {
    const onOpenDocument = vi.fn();
    render(<MarkdownPreview content="[[linked-document.md|リンク先]]" baseDir="C:\\docs" imageVersions={{}} onOpenDocument={onOpenDocument} />);
    fireEvent.click(screen.getByRole("link", { name: "リンク先" }));
    expect(onOpenDocument).toHaveBeenCalledWith("C:/docs/linked-document.md");
  });

  it("opens a non-Markdown spmd relative link as an absolute HTTPS URL", () => {
    vi.mocked(openExternalUrl).mockResolvedValue(undefined);
    render(<MarkdownPreview
      content="[仕様書](../files/spec.pdf)"
      baseDir="spmd://excelchunchun.sharepoint.com/sites/test-team-site/SpoWiki/folder"
      sourcePath="spmd://excelchunchun.sharepoint.com/sites/test-team-site/SpoWiki/folder/README.md"
      imageVersions={{}}
    />);
    fireEvent.click(screen.getByRole("link", { name: "仕様書" }));
    expect(openExternalUrl).toHaveBeenCalledWith("https://excelchunchun.sharepoint.com/sites/test-team-site/SpoWiki/files/spec.pdf");
  });

  it("opens SVG and Mermaid document links in tabs or adjacent windows", () => {
    const onOpenDocument = vi.fn();
    const onOpenDocumentWindow = vi.fn();
    render(<MarkdownPreview
      content="[SVG](diagram.svg) [Mermaid](flow.mmd)"
      baseDir="C:\\docs"
      imageVersions={{}}
      onOpenDocument={onOpenDocument}
      onOpenDocumentWindow={onOpenDocumentWindow}
    />);

    fireEvent.click(screen.getByRole("link", { name: "SVG" }));
    fireEvent.click(screen.getByRole("link", { name: "Mermaid" }), { ctrlKey: true });

    expect(onOpenDocument).toHaveBeenCalledWith("C:/docs/diagram.svg");
    expect(onOpenDocumentWindow).toHaveBeenCalledWith("C:/docs/flow.mmd");
  });

  it("offers confirmed execution only for PowerShell fences backed by a document path", () => {
    render(<MarkdownPreview content={"```pwsh\nWrite-Output safe\n```\n\n```bash\necho no\n```"} baseDir="C:\\docs" documentPath="C:\\docs\\sample.md" imageVersions={{}} />);
    expect(screen.getAllByRole("button", { name: "PowerShellを実行" })).toHaveLength(1);
  });

  it("コードフェンスの相対パス表現を外部ファイル切替へ渡す", async () => {
    const onTextStorageConvert = vi.fn();
    render(<MarkdownPreview
      content={"```ts:src/index.ts\nexport const value = 1;\n```"}
      baseDir="C:\\docs"
      documentPath="C:\\docs\\sample.md"
      imageVersions={{}}
      onTextStorageConvert={onTextStorageConvert}
    />);

    fireEvent.click(screen.getByRole("button", { name: "外部ファイルへ切替" }));

    await waitFor(() => expect(onTextStorageConvert).toHaveBeenCalledWith(expect.objectContaining({
      storage: "embedded",
      language: "ts",
      relativePath: "src/index.ts",
      source: "export const value = 1;",
    })));
  });

  it("preserves a Mermaid block DOM node when surrounding render context changes", () => {
    const imageVersions = {};
    const content = "```mermaid\nflowchart LR\nA --> B\n```";
    const view = render(<MarkdownPreview content={content} baseDir="" imageVersions={imageVersions} mermaidMode="off" imageDisplaySizes={{}} />);
    const block = view.container.querySelector(".mermaid-source");

    view.rerender(<MarkdownPreview
      content={content}
      baseDir=""
      imageVersions={imageVersions}
      mermaidMode="off"
      imageDisplaySizes={{ "image.png": { width: 200, height: 100 } }}
    />);

    expect(view.container.querySelector(".mermaid-source")).toBe(block);
  });

  it("recognizes both PlantUML fence names with local rendering controls", () => {
    render(<MarkdownPreview content={"```plantuml\nA -> B: one\n```\n\n```puml\nB --> A: two\n```"} baseDir="" imageVersions={{}} mermaidMode="off" />);
    expect(screen.getAllByText("PlantUML（ローカル）")).toHaveLength(2);
    expect(screen.getByText(/A -> B: one/)).toBeTruthy();
  });

  it("renders modifier inline code and key fences with the same SVG model", () => {
    const content = "インラインの `Ctrl+S` と `Windows`。\n\n```key\nCtrl+Shift+S\n```";
    const { container } = render(<MarkdownPreview content={content} baseDir="" imageVersions={{}} />);
    expect(container.querySelectorAll("svg.shortcut-key-svg")).toHaveLength(3);
    expect(container.querySelector("svg.shortcut-key-svg--inline")?.getAttribute("aria-label")).toBe("キーボードショートカット: Ctrl + S");
    expect(container.querySelector("svg.shortcut-key-svg--block")?.getAttribute("aria-label")).toBe("キーボードショートカット: Ctrl + Shift + S");
  });

  it("adds a filled swatch only to exact six-digit hexadecimal inline colors", () => {
    const { container } = render(<MarkdownPreview
      content={"`#12Ab34` `#12Ab3` `prefix#12Ab34` `plain code`"}
      baseDir=""
      imageVersions={{}}
    />);
    const inlineCodes = [...container.querySelectorAll<HTMLElement>("code.markdown-inline-code")];
    const colorCode = inlineCodes.find((element) => element.textContent === "#12Ab34")!;
    const ordinary = inlineCodes.find((element) => element.textContent === "plain code")!;
    const swatches = container.querySelectorAll<HTMLElement>(".markdown-inline-code__color-swatch");

    expect(swatches).toHaveLength(1);
    expect(colorCode.classList.contains("markdown-inline-code--color")).toBe(true);
    expect(swatches[0].style.backgroundColor).toBe("rgb(18, 171, 52)");
    expect(ordinary.classList.contains("markdown-inline-code--color")).toBe(false);
    expect(inlineCodes.find((element) => element.textContent === "#12Ab3")?.querySelector(".markdown-inline-code__color-swatch")).toBeNull();
    expect(inlineCodes.find((element) => element.textContent === "prefix#12Ab34")?.querySelector(".markdown-inline-code__color-swatch")).toBeNull();
  });
});

describe("countMermaidFences", () => {
  it("counts both backtick and tilde Mermaid fences", () => {
    expect(countMermaidFences("```mermaid\ngraph TD\n```\n\n~~~Mermaid title\ngraph TD\n~~~")).toBe(2);
  });

  it("does not count Mermaid-looking lines inside another fenced block", () => {
    expect(countMermaidFences("```text\n~~~mermaid\ngraph TD\n~~~\n```\n\n```mermaid\ngraph TD\n```"))
      .toBe(1);
  });

  it("requires a matching closing fence before interpreting later fence-like lines", () => {
    expect(countMermaidFences("````text\n```mermaid\ngraph TD\n```\n````\n\n~~~mermaid\ngraph TD\n~~~~"))
      .toBe(1);
  });

  it("counts Mermaid fences in block quotes", () => {
    expect(countMermaidFences("> ```mermaid\n> graph TD\n> ```")).toBe(1);
  });

  it("counts Mermaid fences in list items", () => {
    expect(countMermaidFences("- Diagram\n\n  ```mermaid\n  graph TD\n  ```")).toBe(1);
  });

  it("counts nested quote and list Mermaid fences", () => {
    expect(countMermaidFences("> - Diagram\n>\n>   ~~~mermaid\n>   graph TD\n>   ~~~")).toBe(1);
  });

  it("does not count Mermaid-looking content in a non-Mermaid fenced block", () => {
    expect(countMermaidFences("> ```text\n> ```mermaid\n> ```\n> ```")).toBe(0);
  });

  it("does not count an indented code block that only looks like a Mermaid fence", () => {
    expect(countMermaidFences("    ```mermaid\n    graph TD\n    ```")).toBe(0);
  });
});
