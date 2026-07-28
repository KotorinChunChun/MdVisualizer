import { describe, expect, it } from "vitest";
import { markdownSanitizeSchema } from "./sanitizeSchema";

describe("markdownSanitizeSchema", () => {
  it("allows only explicit link protocols", () => {
    expect(markdownSanitizeSchema.protocols.href).toEqual(["http", "https", "mailto"]);
    expect(markdownSanitizeSchema.attributes["*"]).not.toContain("onClick");
    expect(markdownSanitizeSchema.attributes["*"]).not.toContain("style");
  });
});
