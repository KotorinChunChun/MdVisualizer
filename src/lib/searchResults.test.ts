import { describe, expect, it } from "vitest";
import { findSearchResults } from "./searchResults";

describe("findSearchResults", () => {
  it("includes source line, context, and heading path", () => {
    const result = findSearchResults("# Root\nintro\n## Child\nfind me\nafter", "find", { contextLines: 1 });
    expect(result.results[0]).toMatchObject({ line: 4, column: 1, headingPath: ["Root", "Child"], before: ["## Child"], after: ["after"] });
  });
  it("caps output and reports invalid expressions", () => {
    expect(findSearchResults("a\na\na", "a", { limit: 2 }).truncated).toBe(true);
    expect(findSearchResults("a", "(", { regex: true }).error).toMatch(/正規表現エラー/);
  });
});
