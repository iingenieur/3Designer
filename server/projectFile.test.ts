import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ProjectFile } from "./projectFile";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "3designer-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("ProjectFile", () => {
  it("reads the current text", () => {
    const path = join(dir, "a.3d.json");
    writeFileSync(path, '{"version":1}');
    const pf = new ProjectFile(path);
    expect(pf.read()).toBe('{"version":1}');
  });

  it("writes pretty JSON and reports whether content changed", () => {
    const path = join(dir, "a.3d.json");
    writeFileSync(path, "{}");
    const pf = new ProjectFile(path);
    expect(pf.write({ version: 1, features: [] })).toBe(true);
    expect(readFileSync(path, "utf8")).toBe('{\n  "version": 1,\n  "features": []\n}\n');
    expect(pf.write({ version: 1, features: [] })).toBe(false); // 같은 내용이면 쓰지 않음
  });

  it("knows whether a change on disk came from its own write", () => {
    const path = join(dir, "a.3d.json");
    writeFileSync(path, "{}");
    const pf = new ProjectFile(path);
    pf.write({ a: 1 });
    expect(pf.isOwnContent(readFileSync(path, "utf8"))).toBe(true);
    writeFileSync(path, '{"a": 2}');
    expect(pf.isOwnContent(readFileSync(path, "utf8"))).toBe(false);
  });

  it("derives the errors file path", () => {
    const pf = new ProjectFile(join(dir, "flange.3d.json"));
    expect(pf.errorsPath).toBe(join(dir, "flange.3d.errors.json"));
  });
});
