import { describe, it, expect, beforeAll } from "vitest";
import { measureVolume } from "replicad";
import { initKernelForNode } from "./testSetup";
import { evaluateFeatures } from "./evaluate";
import { PartSchema } from "../model/schema";
import { resolvePart } from "../model/resolve";

function build(features: unknown[], parameters: Record<string, number> = {}) {
  const part = PartSchema.parse({ version: 1, units: "mm", parameters, features });
  const { resolved, errors } = resolvePart(part);
  expect(errors).toEqual([]);
  return evaluateFeatures(resolved);
}

beforeAll(initKernelForNode);

describe("evaluateFeatures: primitives", () => {
  it("builds a cylinder", () => {
    const { shape, errors } = build([{ id: "c", type: "cylinder", radius: 20, height: 20 }]);
    expect(errors).toEqual([]);
    expect(measureVolume(shape!)).toBeCloseTo(Math.PI * 400 * 20, 3);
  });

  it("builds a box sitting on z=0, centered in XY", () => {
    const { shape } = build([{ id: "b", type: "box", size: [40, 20, 10] }]);
    expect(measureVolume(shape!)).toBeCloseTo(8000, 3);
    expect(shape!.boundingBox.bounds).toEqual([[-20, -10, 0], [20, 10, 10]]);
  });

  it("applies transform position", () => {
    const { shape } = build([{ id: "b", type: "box", size: [40, 20, 10], transform: { position: [5, 0, 3] } }]);
    expect(shape!.boundingBox.bounds).toEqual([[-15, -10, 3], [25, 10, 13]]);
  });

  it("applies transform rotation (deg about Z)", () => {
    const { shape } = build([{ id: "b", type: "box", size: [40, 20, 10], transform: { rotation: [0, 0, 90] } }]);
    const [[minX, minY], [maxX, maxY]] = shape!.boundingBox.bounds;
    expect(minX).toBeCloseTo(-10, 6);
    expect(maxX).toBeCloseTo(10, 6);
    expect(minY).toBeCloseTo(-20, 6);
    expect(maxY).toBeCloseTo(20, 6);
  });

  it("fuses with op add and subtracts with op cut", () => {
    const { shape } = build([
      { id: "b", type: "box", size: [40, 20, 10] },
      { id: "c", type: "cylinder", radius: 5, height: 10, op: "cut" },
    ]);
    expect(measureVolume(shape!)).toBeCloseTo(8000 - Math.PI * 25 * 10, 3);
  });

  it("intersects with op intersect", () => {
    const { shape } = build([
      { id: "b", type: "box", size: [10, 10, 10] },
      { id: "s", type: "sphere", radius: 100, op: "intersect" },
    ]);
    expect(measureVolume(shape!)).toBeCloseTo(1000, 3);
  });

  it("returns null shape and no error for an empty feature list", () => {
    const { shape, errors } = build([]);
    expect(shape).toBeNull();
    expect(errors).toEqual([]);
  });

  it("reports an error when cut comes before any body", () => {
    const { shape, errors } = build([{ id: "c", type: "cylinder", radius: 5, height: 10, op: "cut" }]);
    expect(shape).toBeNull();
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({ featureId: "c", stage: "kernel" });
  });
});

describe("evaluateFeatures: extrude", () => {
  it("extrudes a rectangle on XY", () => {
    const { shape, errors } = build([
      { id: "e", type: "extrude", profile: { kind: "rect", width: 30, height: 10 }, height: 5 },
    ]);
    expect(errors).toEqual([]);
    expect(measureVolume(shape!)).toBeCloseTo(1500, 3);
    expect(shape!.boundingBox.bounds).toEqual([[-15, -5, 0], [15, 5, 5]]);
  });

  it("extrudes a circle on XZ with offset", () => {
    const { shape } = build([
      { id: "e", type: "extrude", profile: { kind: "circle", radius: 5 }, plane: "XZ", offset: 2, height: 10 },
    ]);
    expect(measureVolume(shape!)).toBeCloseTo(Math.PI * 25 * 10, 1);
    const [[, minY], [, maxY]] = shape!.boundingBox.bounds;
    expect(Math.abs(maxY - minY)).toBeCloseTo(10, 6);
  });

  it("extrudes a regular polygon", () => {
    const { shape } = build([
      { id: "e", type: "extrude", profile: { kind: "polygon", sides: 6, radius: 10 }, height: 4 },
    ]);
    const hexArea = (3 * Math.sqrt(3) / 2) * 100;
    expect(measureVolume(shape!)).toBeCloseTo(hexArea * 4, 1);
  });

  it("extrude with op cut removes material", () => {
    const { shape } = build([
      { id: "b", type: "box", size: [40, 40, 5] },
      { id: "e", type: "extrude", profile: { kind: "rect", width: 10, height: 10 }, height: 5, op: "cut" },
    ]);
    expect(measureVolume(shape!)).toBeCloseTo(8000 - 500, 3);
  });
});

describe("evaluateFeatures: pattern", () => {
  it("linear pattern repeats a body", () => {
    const { shape } = build([
      { id: "p", type: "cylinder", radius: 2, height: 5, pattern: { pattern: "linear", count: 3, spacing: 10 } },
    ]);
    expect(measureVolume(shape!)).toBeCloseTo(3 * Math.PI * 4 * 5, 3);
    expect(shape!.boundingBox.bounds[1][0]).toBeCloseTo(22, 6); // 마지막 원통 x = 20 + r
  });

  it("circular pattern repeats a body on a pitch circle", () => {
    const { shape } = build([
      { id: "p", type: "cylinder", radius: 2, height: 5, pattern: { pattern: "circular", count: 4, diameter: 30 } },
    ]);
    expect(measureVolume(shape!)).toBeCloseTo(4 * Math.PI * 4 * 5, 3);
    expect(shape!.boundingBox.bounds[1][0]).toBeCloseTo(17, 6); // 15 + r
  });

  it("pattern with op cut removes each instance", () => {
    const { shape } = build([
      { id: "b", type: "box", size: [40, 40, 5] },
      { id: "p", type: "cylinder", radius: 1.7, height: 5, op: "cut", pattern: { pattern: "circular", count: 4, diameter: 30 } },
    ]);
    expect(measureVolume(shape!)).toBeCloseTo(8000 - 4 * Math.PI * 1.7 ** 2 * 5, 2);
  });
});

describe("evaluateFeatures: hole", () => {
  it("drills through holes at listed positions", () => {
    const { shape, errors } = build([
      { id: "b", type: "box", size: [40, 40, 5] },
      { id: "h", type: "hole", diameter: 3.4, depth: "through", positions: [[15, 0], [-15, 0], [0, 15], [0, -15]] },
    ]);
    expect(errors).toEqual([]);
    expect(measureVolume(shape!)).toBeCloseTo(7818.41594462251, 2);
  });

  it("drills a blind hole from the top face", () => {
    const { shape } = build([
      { id: "b", type: "box", size: [20, 20, 10] },
      { id: "h", type: "hole", diameter: 4, depth: 3, positions: [[0, 0]] },
    ]);
    expect(measureVolume(shape!)).toBeCloseTo(4000 - Math.PI * 4 * 3, 2);
    expect(shape!.boundingBox.bounds).toEqual([[-10, -10, 0], [10, 10, 10]]);
  });

  it("drills holes on a circular pattern", () => {
    const { shape } = build([
      { id: "b", type: "cylinder", radius: 20, height: 8 },
      { id: "h", type: "hole", diameter: 3.4, positions: { pattern: "circular", count: 4, diameter: 30 } },
    ]);
    expect(measureVolume(shape!)).toBeCloseTo(Math.PI * 400 * 8 - 4 * Math.PI * 1.7 ** 2 * 8, 1);
  });

  it("reports an error when there is no body", () => {
    const { errors } = build([{ id: "h", type: "hole", diameter: 3, positions: [[0, 0]] }]);
    expect(errors[0]).toMatchObject({ featureId: "h", stage: "kernel" });
  });
});
