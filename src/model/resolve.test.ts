import { describe, it, expect } from "vitest";
import { PartSchema } from "./schema";
import { resolvePart } from "./resolve";

describe("resolvePart", () => {
  it("replaces expressions with numbers", () => {
    const part = PartSchema.parse({
      version: 1,
      units: "mm",
      parameters: { D: 40, H: 20 },
      features: [
        { id: "f1", type: "cylinder", radius: "D/2", height: "H" },
        { id: "f2", type: "box", size: ["D", 10, "H/2"], transform: { position: [0, 0, "H"] } },
      ],
    });
    const { resolved, errors } = resolvePart(part);
    expect(errors).toEqual([]);
    expect(resolved.features[0]).toMatchObject({ type: "cylinder", radius: 20, height: 20 });
    expect(resolved.features[1]).toMatchObject({ size: [40, 10, 10], transform: { position: [0, 0, 20] } });
  });

  it("keeps enum strings untouched", () => {
    const part = PartSchema.parse({
      version: 1,
      units: "mm",
      features: [
        { id: "h", type: "hole", diameter: 3, depth: "through", positions: [[0, 0]] },
        { id: "f", type: "fillet", radius: 1, edges: "top" },
        { id: "e", type: "extrude", profile: { kind: "circle", radius: 5 }, plane: "XZ", height: 3, op: "cut" },
      ],
    });
    const { resolved, errors } = resolvePart(part);
    expect(errors).toEqual([]);
    expect(resolved.features[0]).toMatchObject({ depth: "through" });
    expect(resolved.features[1]).toMatchObject({ edges: "top" });
    expect(resolved.features[2]).toMatchObject({ plane: "XZ", op: "cut", profile: { kind: "circle", radius: 5 } });
  });

  it("reports per-feature errors and drops the failing feature", () => {
    const part = PartSchema.parse({
      version: 1,
      units: "mm",
      features: [
        { id: "ok", type: "box", size: [1, 1, 1] },
        { id: "bad", type: "cylinder", radius: "R", height: 1 },
      ],
    });
    const { resolved, errors } = resolvePart(part);
    expect(resolved.features.map((f) => f.id)).toEqual(["ok"]);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({ featureId: "bad", stage: "expression" });
    expect(errors[0].message).toContain('알 수 없는 변수 "R"');
  });

  it("skips suppressed features", () => {
    const part = PartSchema.parse({
      version: 1,
      units: "mm",
      features: [
        { id: "a", type: "box", size: [1, 1, 1] },
        { id: "b", type: "sphere", radius: 1, suppressed: true },
      ],
    });
    const { resolved } = resolvePart(part);
    expect(resolved.features.map((f) => f.id)).toEqual(["a"]);
  });
});
