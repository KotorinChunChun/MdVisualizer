import { describe, expect, it } from "vitest";
import { parseSkill, visibleSkills } from "./skills";

describe("Codex skill metadata", () => {
  it("rejects malformed YAML and dangerous aliases", () => {
    for (const field of ["targets: false", "contextTargets: false", "inputs: false", "inputs: null"]) {
      expect(parseSkill({ id: "bad", source: `---\nname: bad\ndescription: x\nmetadata:\n  mdvisualizer:\n    enabled: true\n    ${field}\n---\n\nbody` }).error).toBeTruthy();
    }
    expect(parseSkill({ id: "bad", source: "---\nname: bad\ndescription: x\ntargets: [\n---\n\nbody" }).error).toBeTruthy();
    expect(parseSkill({ id: "bad", source: `---\nname: bad\ndescription: x\nmetadata:\n  mdvisualizer: &x\n    targets: [text]\n  aliases: [${Array.from({ length: 25 }, () => "*x").join(", ")}]\n---\n\nbody` }).error).toBeTruthy();
    expect(parseSkill({ id: "bad", source: `---\nname: bad\ndescription: x\n---\n\n${"x".repeat(131073)}` }).error).toBeTruthy();
  });

  it("supports per-target menu visibility while keeping legacy flags", () => {
    const make = (id: string, extra: string) => parseSkill({ id, source: `---\nname: ${id}\ndescription: ${id}\nmetadata:\n  mdvisualizer:\n    enabled: true\n    targets: [svg, image]\n    ${extra}\n---\n\nbody` });
    const context = make("context", "contextMenu: false\n    contextTargets: [svg]");
    const block = make("block", "blockMenu: false\n    blockTargets: [svg]");
    expect(visibleSkills([context], "svg", "contextMenu")).toHaveLength(1);
    expect(visibleSkills([context], "image", "contextMenu")).toHaveLength(0);
    expect(visibleSkills([block], "svg", "blockMenu")).toHaveLength(1);
  });

  it("prefers an explicitly edited target list over the legacy menu flag", () => {
    const skill = parseSkill({ id: "demo", source: "---\nname: demo\ndescription: demo\nmetadata:\n  mdvisualizer:\n    enabled: true\n    targets: [svg, mermaid]\n    contextMenu: true\n    contextTargets: [svg]\n---\n\nbody" });
    expect(visibleSkills([skill], "svg", "contextMenu")).toHaveLength(1);
    expect(visibleSkills([skill], "mermaid", "contextMenu")).toHaveLength(0);
  });
});
