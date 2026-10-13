import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { measureVolume } from "replicad";
import { initKernelForNode } from "./node";
import { evaluateFeatures } from "./evaluate";
import { PartSchema } from "../model/schema";
import { resolvePart } from "../model/resolve";

const dir = fileURLToPath(new URL("../../examples", import.meta.url));

beforeAll(initKernelForNode);

describe("examples", () => {
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".3d.json"))) {
    it(`${file} builds without errors and matches snapshot`, () => {
      const part = PartSchema.parse(JSON.parse(readFileSync(join(dir, file), "utf8")));
      const { resolved, errors: exprErrors } = resolvePart(part);
      expect(exprErrors).toEqual([]);
      const { shape, errors } = evaluateFeatures(resolved);
      expect(errors).toEqual([]);
      expect(shape).not.toBeNull();
      const [[x0, y0, z0], [x1, y1, z1]] = shape!.boundingBox.bounds;
      const summary = {
        volume: Number(measureVolume(shape!).toFixed(2)),
        size: [x1 - x0, y1 - y0, z1 - z0].map((v) => Number(v.toFixed(2))),
        faces: shape!.faces.length,
      };
      expect(summary).toMatchSnapshot();
    });
  }
});
