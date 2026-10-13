import { describe, it, expect } from "vitest";
import { PartSchema } from "./schema";

const flange = {
  version: 1,
  units: "mm",
  parameters: { D: 40, H: 20, boltPCD: 30 },
  features: [
    { id: "f1", type: "cylinder", name: "본체", radius: "D/2", height: "H" },
    {
      id: "f2",
      type: "hole",
      name: "볼트 구멍",
      diameter: 3.4,
      depth: "through",
      positions: { pattern: "circular", count: 4, diameter: "boltPCD" },
    },
    { id: "f3", type: "fillet", name: "윗면 필렛", edges: "top", radius: 2 },
  ],
};

describe("PartSchema", () => {
  it("accepts a valid part", () => {
    const result = PartSchema.safeParse(flange);
    expect(result.success).toBe(true);
  });

  it("defaults parameters and transform", () => {
    const part = PartSchema.parse({
      version: 1,
      units: "mm",
      features: [{ id: "a", type: "box", size: [10, 10, 10] }],
    });
    expect(part.parameters).toEqual({});
    const f = part.features[0];
    expect(f.type === "box" && f.op).toBe("add");
    expect(f.suppressed).toBe(false);
  });

  it("rejects unknown feature type", () => {
    const result = PartSchema.safeParse({
      version: 1,
      units: "mm",
      features: [{ id: "a", type: "torus" }],
    });
    expect(result.success).toBe(false);
  });

  it("rejects duplicate feature ids", () => {
    const result = PartSchema.safeParse({
      version: 1,
      units: "mm",
      features: [
        { id: "a", type: "box", size: [1, 1, 1] },
        { id: "a", type: "sphere", radius: 1 },
      ],
    });
    expect(result.success).toBe(false);
    expect(JSON.stringify(result.error?.issues)).toContain("중복");
  });

  it("rejects whitespace-only expressions and trims surrounding whitespace", () => {
    const bad = PartSchema.safeParse({
      version: 1,
      units: "mm",
      features: [{ id: "a", type: "sphere", radius: "  " }],
    });
    expect(bad.success).toBe(false);

    const part = PartSchema.parse({
      version: 1,
      units: "mm",
      parameters: { D: 10 },
      features: [{ id: "a", type: "sphere", radius: "  D/2 " }],
    });
    const f = part.features[0];
    expect(f.type === "sphere" && f.radius).toBe("D/2");
  });

  it("accepts expressions in numeric fields", () => {
    const part = PartSchema.parse({
      version: 1,
      units: "mm",
      parameters: { W: 10 },
      features: [{ id: "a", type: "box", size: ["W", "W*2", 5] }],
    });
    expect(part.features[0].type).toBe("box");
  });
});
