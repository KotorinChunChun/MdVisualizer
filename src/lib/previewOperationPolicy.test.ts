import { describe, expect, it } from "vitest";
import { previewOperationPolicy } from "./previewOperationPolicy";

describe("操作可否の状態表", () => {
  for (const interactionMode of ["browse", "edit"] as const) {
    for (const writable of [true, false]) {
      for (const printing of [true, false]) {
        for (const saving of [true, false]) {
          for (const presentation of [true, false]) {
            it(JSON.stringify({ interactionMode, writable, printing, saving, presentation }), () => {
              const policy = previewOperationPolicy({ interactionMode, writable, printing, saving, presentation });
              const expected = writable && !printing && !saving && !presentation;
              expect(policy.editBlocks).toBe(expected);
              expect(policy.convertStorage).toBe(expected);
              expect(policy.directEditing).toBe(expected && interactionMode === "edit");
            });
          }
        }
      }
    }
  }
});
