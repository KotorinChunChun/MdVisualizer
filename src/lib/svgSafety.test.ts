import { describe, expect, it } from "vitest";
import { sanitizeSvgXml } from "./svgSafety";

describe("SVG safety", () => {
  it("removes executable elements, event handlers, styles, and external references", () => {
    const result = sanitizeSvgXml('<svg xmlns="http://www.w3.org/2000/svg" onload="bad()"><script>bad()</script><style>path{fill:red}</style><image href="https://evil.test/a.png"/><path onclick="bad()" style="fill:url(https://evil.test/a)" d="M0 0"/></svg>');
    expect(result).not.toMatch(/script|onload|onclick|https:|<style/i);
    expect(result).toContain('d="M0 0"');
  });

  it("keeps local fragment references and rejects malformed XML", () => {
    expect(sanitizeSvgXml('<svg xmlns="http://www.w3.org/2000/svg"><use href="#shape"/></svg>')).toContain('href="#shape"');
    expect(() => sanitizeSvgXml("<svg><path></svg>")).toThrow("有効なSVG");
  });
});
