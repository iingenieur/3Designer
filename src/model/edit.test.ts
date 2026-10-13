import { describe, it, expect } from "vitest";
import { PartSchema } from "./schema";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { setParameter, updateFeature, moveFeature, deleteFeature, toggleSuppressed, compactPart } from "./edit";

const base = PartSchema.parse({
  version: 1,
  units: "mm",
  parameters: { D: 40 },
  features: [
    { id: "a", type: "cylinder", radius: "D/2", height: 10 },
    { id: "b", type: "hole", diameter: 3, positions: [[0, 0]] },
    { id: "c", type: "fillet", radius: 1, edges: "top" },
  ],
});

describe("edit", () => {
  it("setParameter replaces a value without mutating the input", () => {
    const next = setParameter(base, "D", 50);
    expect(next.parameters.D).toBe(50);
    expect(base.parameters.D).toBe(40);
  });

  it("updateFeature merges fields", () => {
    const next = updateFeature(base, "a", { height: 20 });
    expect(next.features[0]).toMatchObject({ id: "a", height: 20, radius: "D/2" });
  });

  it("moveFeature reorders", () => {
    expect(moveFeature(base, "c", 0).features.map((f) => f.id)).toEqual(["c", "a", "b"]);
    expect(moveFeature(base, "a", 2).features.map((f) => f.id)).toEqual(["b", "c", "a"]);
  });

  it("moveFeature clamps the target index and ignores unknown ids", () => {
    expect(moveFeature(base, "a", 99).features.map((f) => f.id)).toEqual(["b", "c", "a"]);
    expect(moveFeature(base, "c", -5).features.map((f) => f.id)).toEqual(["c", "a", "b"]);
    expect(moveFeature(base, "zzz", 0)).toBe(base);
  });

  it("deleteFeature removes by id", () => {
    expect(deleteFeature(base, "b").features.map((f) => f.id)).toEqual(["a", "c"]);
  });

  it("toggleSuppressed flips the flag", () => {
    const next = toggleSuppressed(base, "b");
    expect(next.features[1].suppressed).toBe(true);
    expect(toggleSuppressed(next, "b").features[1].suppressed).toBe(false);
  });
});

describe("compactPart", () => {
  const text = readFileSync(fileURLToPath(new URL("../../examples/flange.3d.json", import.meta.url)), "utf8");
  const original = JSON.parse(text) as { features: Record<string, unknown>[] };

  it("round-trips a file that already omits defaults (keys and values)", () => {
    const compact = JSON.parse(JSON.stringify(compactPart(PartSchema.parse(original)))) as typeof original;
    expect(compact).toEqual(original);
    expect(Object.keys(compact)).toEqual(["version", "units", "parameters", "features"]);
    for (const f of compact.features) expect(Object.keys(f).slice(0, 3)).toEqual(["id", "type", "name"]);
  });

  it("keeps non-default values", () => {
    const part = PartSchema.parse({
      version: 1,
      units: "mm",
      features: [
        { id: "a", type: "cylinder", radius: 5, height: 10, suppressed: true },
        { id: "b", type: "hole", diameter: 3, depth: 5, positions: { pattern: "linear", count: 2, spacing: 4, direction: "Y" } },
      ],
    });
    const compact = JSON.parse(JSON.stringify(compactPart(part))) as { features: Record<string, unknown>[] };
    expect(compact.features[0]).toEqual({ id: "a", type: "cylinder", radius: 5, height: 10, suppressed: true });
    expect(compact.features[1]).toEqual({
      id: "b",
      type: "hole",
      diameter: 3,
      depth: 5,
      positions: { pattern: "linear", count: 2, spacing: 4, direction: "Y" },
    });
  });
});
