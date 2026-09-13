import { describe, expect, it } from "vitest";
import { AssetWorkspace } from "./workspace";

describe("AssetWorkspace", () => {
  it("resolves only normalized workspace-relative assets", () => {
    const workspace = new AssetWorkspace();
    workspace.put("images/example.png", new Blob(["image"], { type: "image/png" }));
    expect(workspace.resolve("images/example.png")).toMatch(/^blob:/);
    expect(workspace.resolve("https://example.invalid/image.png")).toBe("https://example.invalid/image.png");
    expect(workspace.resolve("../secret.png")).toBe("../secret.png");
    workspace.clear();
  });
});
