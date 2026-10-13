import { describe, it, expect, vi, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { PartSchema } from "../model/schema";
import { modelMatches, registerCapture, captureScreenshot, waitFor } from "./screenshot";

const flangeText = readFileSync(fileURLToPath(new URL("../../examples/flange.3d.json", import.meta.url)), "utf8");
const flange = PartSchema.parse(JSON.parse(flangeText));

describe("modelMatches", () => {
  it("같은 모델이면 true", () => {
    expect(modelMatches(flange, flangeText)).toBe(true);
  });

  it("파라미터가 다르면 false", () => {
    const changed = { ...flange, parameters: { ...flange.parameters, D: 50 } };
    expect(modelMatches(changed, flangeText)).toBe(false);
  });

  it("피처 필드가 다르면 false", () => {
    const changed = {
      ...flange,
      features: flange.features.map((f) => (f.id === "edge" ? { ...f, suppressed: true } : f)),
    };
    expect(modelMatches(changed, flangeText)).toBe(false);
  });

  it("기본값 명시 여부만 다르면 true", () => {
    const raw = JSON.parse(flangeText);
    for (const f of raw.features) {
      f.suppressed = false;
      if (f.op === undefined) f.op = "add";
    }
    expect(modelMatches(flange, JSON.stringify(raw))).toBe(true);
  });

  it("키 순서만 다르면 true", () => {
    const raw = JSON.parse(flangeText);
    const reordered = {
      features: raw.features.map((f: Record<string, unknown>) => {
        const entries = Object.entries(f).reverse();
        return Object.fromEntries(entries);
      }),
      parameters: Object.fromEntries(Object.entries(raw.parameters).reverse()),
      units: raw.units,
      version: raw.version,
    };
    expect(modelMatches(flange, JSON.stringify(reordered))).toBe(true);
  });

  it("텍스트가 undefined면 true", () => {
    expect(modelMatches(flange, undefined)).toBe(true);
    expect(modelMatches(null, undefined)).toBe(true);
  });

  it("깨진 JSON이면 true", () => {
    expect(modelMatches(flange, "{ not json")).toBe(true);
  });

  it("스키마에 안 맞는 텍스트면 true", () => {
    expect(modelMatches(flange, JSON.stringify({ version: 1, units: "mm" }))).toBe(true);
  });

  it("part가 null이면 false", () => {
    expect(modelMatches(null, flangeText)).toBe(false);
  });
});

describe("captureScreenshot", () => {
  afterEach(() => registerCapture(null));

  it("등록 전에는 던진다", () => {
    expect(() => captureScreenshot()).toThrow("뷰포트가 아직 준비되지 않았습니다.");
  });

  it("등록 후에는 값을 돌려준다", () => {
    registerCapture(() => "data:image/png;base64,AAA");
    expect(captureScreenshot()).toBe("data:image/png;base64,AAA");
  });

  it("null로 재등록하면 다시 던진다", () => {
    registerCapture(() => "x");
    registerCapture(null);
    expect(() => captureScreenshot()).toThrow("뷰포트가 아직 준비되지 않았습니다.");
  });
});

describe("waitFor", () => {
  /** 가짜 스토어 구독: notify()로 모든 구독자를 깨운다. */
  function fakeStore() {
    const listeners = new Set<() => void>();
    return {
      listeners,
      subscribe: (cb: () => void) => {
        listeners.add(cb);
        return () => listeners.delete(cb);
      },
      notify: () => listeners.forEach((cb) => cb()),
    };
  }

  afterEach(() => vi.useRealTimers());

  it("처음부터 조건이 맞으면 구독 없이 즉시 true", async () => {
    const store = fakeStore();
    await expect(waitFor(() => true, store.subscribe, 1000)).resolves.toBe(true);
    expect(store.listeners.size).toBe(0);
  });

  it("나중에 조건이 맞으면 true가 되고 구독이 풀린다", async () => {
    vi.useFakeTimers();
    const store = fakeStore();
    let ok = false;
    const p = waitFor(() => ok, store.subscribe, 1000);
    expect(store.listeners.size).toBe(1);
    store.notify(); // 아직 아니다
    ok = true;
    store.notify();
    await expect(p).resolves.toBe(true);
    expect(store.listeners.size).toBe(0);
    // 타이머가 남아 있어도 다시 resolve하지 않는다
    vi.advanceTimersByTime(2000);
  });

  it("시간이 넘으면 false가 되고 구독이 풀린다", async () => {
    vi.useFakeTimers();
    const store = fakeStore();
    const p = waitFor(() => false, store.subscribe, 1000);
    vi.advanceTimersByTime(999);
    expect(store.listeners.size).toBe(1);
    vi.advanceTimersByTime(1);
    await expect(p).resolves.toBe(false);
    expect(store.listeners.size).toBe(0);
  });

  it("타임아웃 뒤에 조건이 맞아도 결과는 false 그대로", async () => {
    vi.useFakeTimers();
    const store = fakeStore();
    let ok = false;
    const p = waitFor(() => ok, store.subscribe, 1000);
    vi.advanceTimersByTime(1000);
    ok = true;
    store.notify();
    await expect(p).resolves.toBe(false);
  });

  it("구독 콜백이 동기적으로 여러 번 불려도 한 번만 처리한다", async () => {
    vi.useFakeTimers();
    const store = fakeStore();
    let calls = 0;
    const isCurrent = () => {
      calls++;
      return true;
    };
    let ok = false;
    const p = waitFor(() => ok && isCurrent(), store.subscribe, 1000);
    ok = true;
    // 첫 콜백이 구독을 풀기 전에 두 번째 알림이 겹치는 상황을 흉내 낸다
    const cbs = [...store.listeners];
    cbs.forEach((cb) => cb());
    cbs.forEach((cb) => cb());
    await expect(p).resolves.toBe(true);
    expect(calls).toBe(1);
    expect(store.listeners.size).toBe(0);
  });
});
