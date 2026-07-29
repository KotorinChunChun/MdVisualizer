import { describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: (path: string) => `asset://${path}`,
}));

import { isAbsoluteLocalPath, isWindowsAbsolutePath, resolveImageSrc } from "./path";

describe("Windows image paths", () => {
  it.each(["C:/images/a.png", "C:\\images\\a.png", "z:/x/y.png"])("recognizes %s as an absolute Windows path", (path) => {
    expect(isWindowsAbsolutePath(path)).toBe(true);
    expect(isAbsoluteLocalPath(path)).toBe(true);
  });

  it("does not prepend baseDir to a drive path written with forward slashes", () => {
    expect(resolveImageSrc("C:/images/a.png", "C:\\docs")).toBe("asset://C:/images/a.png");
  });
});
