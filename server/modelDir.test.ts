import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { listModels, resolveModel, pickInitialModel } from "./modelDir";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "3designer-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("listModels", () => {
  it("lists *.3d.json basenames sorted, ignoring errors files and other files", () => {
    writeFileSync(join(dir, "b.3d.json"), "{}");
    writeFileSync(join(dir, "a.3d.json"), "{}");
    writeFileSync(join(dir, "a.3d.errors.json"), "{}");
    writeFileSync(join(dir, "notes.json"), "{}");
    writeFileSync(join(dir, "part.stl"), "");
    mkdirSync(join(dir, "sub.3d.json")); // 디렉터리는 제외
    expect(listModels(dir)).toEqual(["a.3d.json", "b.3d.json"]);
  });

  it("returns [] for a missing directory", () => {
    expect(listModels(join(dir, "nope"))).toEqual([]);
  });
});

describe("resolveModel", () => {
  it("resolves a listed basename to an absolute path", () => {
    writeFileSync(join(dir, "a.3d.json"), "{}");
    expect(resolveModel(dir, "a.3d.json")).toBe(join(dir, "a.3d.json"));
  });

  it("rejects names that are not listed models (traversal, wrong suffix, missing)", () => {
    writeFileSync(join(dir, "a.3d.json"), "{}");
    writeFileSync(join(dir, "x.json"), "{}");
    expect(resolveModel(dir, "../a.3d.json")).toBeNull();
    expect(resolveModel(dir, "sub/a.3d.json")).toBeNull();
    expect(resolveModel(dir, "x.json")).toBeNull();
    expect(resolveModel(dir, "missing.3d.json")).toBeNull();
    expect(resolveModel(dir, "")).toBeNull();
  });
});

describe("pickInitialModel", () => {
  it("returns a model file path as is", () => {
    const p = join(dir, "a.3d.json");
    writeFileSync(p, "{}");
    expect(pickInitialModel(p)).toBe(p);
  });

  it("picks the first model in a directory", () => {
    writeFileSync(join(dir, "b.3d.json"), "{}");
    writeFileSync(join(dir, "a.3d.json"), "{}");
    expect(pickInitialModel(dir)).toBe(join(dir, "a.3d.json"));
  });

  it("returns null for an empty directory or a missing path", () => {
    expect(pickInitialModel(dir)).toBeNull();
    expect(pickInitialModel(join(dir, "nope.3d.json"))).toBeNull();
  });
});
