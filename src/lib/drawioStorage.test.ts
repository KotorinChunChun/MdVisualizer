import { describe, expect, it } from "vitest";
import { drawioEmbeddedFence, drawioExternalReference, markdownLineEnding, preferredDrawioFilename } from "./drawioStorage";
import type { CodeFenceOccurrence } from "./markdownOccurrences";

describe("draw.io storage conversion", () => {
  it("creates a safe external image reference", () => {
    expect(drawioExternalReference("diagrams/system.drawio", "構成図")).toBe("![構成図](diagrams/system.drawio)");
    expect(drawioExternalReference("my diagrams/system.drawio")).toBe("![](<my diagrams/system.drawio>)");
  });

  it("creates a fence longer than backticks contained in draw.io XML", () => {
    const result = drawioEmbeddedFence("<mxfile value=\"```\"/>\r\n", "\r\n");
    expect(result).toBe("````drawio\r\n<mxfile value=\"```\"/>\r\n````");
  });

  it("keeps the document line ending and derives an optional title filename", () => {
    expect(markdownLineEnding("one\r\ntwo")).toBe("\r\n");
    expect(preferredDrawioFilename({ meta: 'title="システム 構成"' } as CodeFenceOccurrence)).toBe("システム-構成.drawio");
    expect(preferredDrawioFilename({ meta: "title=system.drawio" } as CodeFenceOccurrence)).toBe("system.drawio");
  });
});
