import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { validatePart, parsePart } from "./validate";

const flange = readFileSync(fileURLToPath(new URL("../examples/flange.3d.json", import.meta.url)), "utf8");

describe("parsePart", () => {
  it("JSON 문법 오류를 schema 오류로 돌려준다", () => {
    const r = parsePart("{ nope");
    expect(r.part).toBeNull();
    expect(r.schema).toHaveLength(1);
    expect(r.schema[0].path).toBe("");
    expect(r.schema[0].message).toMatch(/JSON 문법 오류/);
  });

  it("스키마 오류의 경로를 점으로 잇는다", () => {
    const r = parsePart({ version: 1, units: "mm", features: [{ id: "a", type: "box" }] });
    expect(r.part).toBeNull();
    expect(r.schema.map((e) => e.path)).toContain("features.0.size");
  });

  it("객체와 문자열 둘 다 받는다", () => {
    expect(parsePart(flange).part).not.toBeNull();
    expect(parsePart(JSON.parse(flange)).part).not.toBeNull();
    expect(parsePart(flange).schema).toEqual([]);
  });
});

describe("validatePart", () => {
  it("플랜지는 ok이고 치수·부피가 있다", async () => {
    const r = await validatePart(flange);
    expect(r.ok).toBe(true);
    expect(r.schema).toEqual([]);
    expect(r.features).toEqual([]);
    expect(r.measurements?.bounds).toEqual([
      [-20, -20, 0],
      [20, 20, 14],
    ]);
    expect(r.measurements?.size).toEqual([40, 40, 14]);
    expect(r.measurements?.volume).toBeCloseTo(10249.04, 1);
    expect(r.warnings).toEqual([]);
  });

  it("스키마 오류면 커널 결과 없이 schema만 채운다", async () => {
    const r = await validatePart("{ nope");
    expect(r.ok).toBe(false);
    expect(r.schema.length).toBe(1);
    expect(r.features).toEqual([]);
    expect(r.measurements).toBeNull();
    expect(r.warnings).toEqual([]);
  });

  it("수식 오류는 features에 stage expression으로", async () => {
    const part = JSON.parse(flange);
    part.features[0].radius = "D /";
    const r = await validatePart(part);
    expect(r.ok).toBe(false);
    expect(r.schema).toEqual([]);
    expect(r.features[0]).toMatchObject({ featureId: "body", stage: "expression" });
    // 실패한 피처를 뺀 나머지 형상은 측정한다
    expect(r.measurements).not.toBeNull();
  });

  it("커널 오류는 features에 stage kernel로, 나머지 형상은 측정한다", async () => {
    const part = JSON.parse(flange);
    part.features[4].radius = 50;
    const r = await validatePart(part);
    expect(r.ok).toBe(false);
    expect(r.features).toHaveLength(1);
    expect(r.features[0]).toMatchObject({ featureId: "edge", stage: "kernel" });
    expect(r.measurements).not.toBeNull();
    expect(r.measurements?.size).toEqual([40, 40, 14]);
  });

  it("바닥이 Z=0 아래면 경고한다", async () => {
    const r = await validatePart({ version: 1, units: "mm", features: [{ id: "s", type: "sphere", radius: 5 }] });
    expect(r.ok).toBe(true);
    expect(r.measurements?.bounds[0][2]).toBe(-5);
    expect(r.warnings).toHaveLength(1);
    expect(r.warnings[0]).toMatch(/Z=0 아래/);
  });

  it("피처가 없으면 ok가 아니고 경고한다", async () => {
    const r = await validatePart({ version: 1, units: "mm", features: [] });
    expect(r.ok).toBe(false);
    expect(r.schema).toEqual([]);
    expect(r.features).toEqual([]);
    expect(r.measurements).toBeNull();
    expect(r.warnings[0]).toMatch(/피처가 없/);
  });

  it("모든 피처가 꺼져 있으면 형상이 비었다고 경고한다", async () => {
    const r = await validatePart({
      version: 1,
      units: "mm",
      features: [{ id: "b", type: "box", size: [10, 10, 10], suppressed: true }],
    });
    expect(r.ok).toBe(false);
    expect(r.features).toEqual([]);
    expect(r.measurements).toBeNull();
    expect(r.warnings[0]).toMatch(/모든 피처가 꺼져/);
  });

  it("겹치지 않는 교집합으로 형상이 비면 reject되지 않고 경고한다", async () => {
    const r = await validatePart({
      version: 1,
      units: "mm",
      features: [
        { id: "b", type: "box", size: [10, 10, 10] },
        { id: "c", type: "box", size: [10, 10, 10], op: "intersect", transform: { position: [50, 50, 50] } },
      ],
    });
    expect(r.ok).toBe(false);
    expect(r.features).toEqual([]);
    expect(r.measurements).toBeNull();
    expect(r.warnings[0]).toMatch(/형상이 비어/);
  });
});
