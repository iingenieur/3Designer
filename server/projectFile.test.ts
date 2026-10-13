import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ProjectFile } from "./projectFile";
import { writeFileAtomic } from "./atomicWrite";

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

describe("writeFileAtomic", () => {
  it("내용을 쓰고 임시 파일을 남기지 않는다", () => {
    const path = join(dir, "a.3d.json");
    writeFileAtomic(path, "first\n");
    expect(readFileSync(path, "utf8")).toBe("first\n");
    writeFileAtomic(path, "second\n"); // 기존 파일 덮어쓰기
    expect(readFileSync(path, "utf8")).toBe("second\n");
    expect(readdirSync(dir)).toEqual(["a.3d.json"]);
  });

  it("실패하면 임시 파일을 치우고 던진다", () => {
    const asDir = join(dir, "a.3d.json");
    mkdirSync(asDir); // 디렉터리 위로는 rename할 수 없다
    expect(() => writeFileAtomic(asDir, "x")).toThrow();
    expect(readdirSync(dir)).toEqual(["a.3d.json"]);
  });

  it("ProjectFile.write와 writeErrors도 임시 파일을 남기지 않는다", () => {
    const pf = new ProjectFile(join(dir, "flange.3d.json"));
    pf.write({ version: 1 });
    pf.writeErrors({ schema: [], features: [] });
    expect(readdirSync(dir).sort()).toEqual(["flange.3d.errors.json", "flange.3d.json"]);
    expect(readFileSync(pf.errorsPath, "utf8")).toBe('{\n  "schema": [],\n  "features": []\n}\n');
  });
});
