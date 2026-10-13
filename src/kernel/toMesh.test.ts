import { describe, it, expect, beforeAll } from "vitest";
import { makeBaseBox } from "replicad";
import { initKernelForNode } from "./testSetup";
import { shapeToMesh } from "./toMesh";

beforeAll(initKernelForNode);

describe("shapeToMesh", () => {
  it("returns typed arrays, bounds and volume", () => {
    const mesh = shapeToMesh(makeBaseBox(10, 20, 30));
    expect(mesh.positions).toBeInstanceOf(Float32Array);
    expect(mesh.normals).toBeInstanceOf(Float32Array);
    expect(mesh.indices).toBeInstanceOf(Uint32Array);
    expect(mesh.edges).toBeInstanceOf(Float32Array);
    expect(mesh.positions.length % 3).toBe(0);
    expect(mesh.indices.length).toBeGreaterThanOrEqual(36); // 6 faces × 2 triangles × 3
    expect(mesh.bounds).toEqual([[-5, -10, 0], [5, 10, 30]]);
    expect(mesh.volume).toBeCloseTo(6000, 3);
  });
});
