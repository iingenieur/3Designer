import { describe, it, expect, vi, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { PartSchema } from "../model/schema";
import { prepareMatcher, isCurrentState, registerCapture, captureScreenshot, waitFor } from "./screenshot";

const flangeText = readFileSync(fileURLToPath(new URL("../../examples/flange.3d.json", import.meta.url)), "utf8");
const flange = PartSchema.parse(JSON.parse(flangeText));

describe("prepareMatcher", () => {
  it("같은 모델이면 true", () => {
    expect(prepareMatcher(flangeText)(flange)).toBe(true);
  });

  it("파라미터가 다르면 false", () => {
    const changed = { ...flange, parameters: { ...flange.parameters, D: 50 } };
    expect(prepareMatcher(flangeText)(changed)).toBe(false);
  });

  it("피처 필드가 다르면 false", () => {
    const changed = {
      ...flange,
      features: flange.features.map((f) => (f.id === "edge" ? { ...f, suppressed: true } : f)),
    };
    expect(prepareMatcher(flangeText)(changed)).toBe(false);
  });

  it("피처 순서가 다르면 false", () => {
    const changed = { ...flange, features: [...flange.features].reverse() };
    expect(prepareMatcher(flangeText)(changed)).toBe(false);
  });

  it("기본값 명시 여부만 다르면 true", () => {
    const raw = JSON.parse(flangeText);
    for (const f of raw.features) {
      f.suppressed = false;
      if (f.op === undefined) f.op = "add";
    }
    expect(prepareMatcher(JSON.stringify(raw))(flange)).toBe(true);
  });

  it("키 순서만 다르면 true", () => {
    const raw = JSON.parse(flangeText);
    const reordered = {
      features: raw.features.map((f: Record<string, unknown>) => Object.fromEntries(Object.entries(f).reverse())),
      parameters: Object.fromEntries(Object.entries(raw.parameters).reverse()),
      units: raw.units,
      version: raw.version,
    };
    expect(prepareMatcher(JSON.stringify(reordered))(flange)).toBe(true);
  });

  it("텍스트가 undefined면 항상 true", () => {
    const matches = prepareMatcher(undefined);
    expect(matches(flange)).toBe(true);
    expect(matches(null)).toBe(true);
  });

  it("깨진 JSON이면 true", () => {
    expect(prepareMatcher("{ not json")(flange)).toBe(true);
  });

  it("스키마에 안 맞는 텍스트면 true", () => {
    expect(prepareMatcher(JSON.stringify({ version: 1, units: "mm" }))(flange)).toBe(true);
  });

  it("part가 null이면 false", () => {
    expect(prepareMatcher(flangeText)(null)).toBe(false);
  });

  it("텍스트는 한 번만 파싱한다", () => {
    const spy = vi.spyOn(JSON, "parse");
    const matches = prepareMatcher(flangeText);
    const after = spy.mock.calls.length;
    matches(flange);
    matches(flange);
    matches(null);
    expect(spy.mock.calls.length).toBe(after);
    spy.mockRestore();
  });
});

describe("isCurrentState", () => {
  const matches = prepareMatcher(flangeText);
  const other = { ...flange, parameters: { ...flange.parameters, D: 50 } };
  const none: { featureId: string }[] = [];
  const kernelFail = [{ featureId: "*" }];
  const featureFail = [{ featureId: "edge" }];

  it.each([
    // 새 part만 set됐고 메시는 아직 옛 모델의 것 → wait (kernelStatus와 무관)
    ["옛 메시, ready", { meshPart: other, kernelStatus: "ready", featureErrors: none }, "wait"],
    ["옛 메시, busy", { meshPart: other, kernelStatus: "busy", featureErrors: none }, "wait"],
    ["메시 없음, loading", { meshPart: null, kernelStatus: "loading", featureErrors: none }, "wait"],
    ["메시 없음, ready", { meshPart: null, kernelStatus: "ready", featureErrors: none }, "wait"],
    // 메시가 새 모델의 것 → ready (busy여도 그 메시는 유효하다)
    ["새 메시, ready", { meshPart: flange, kernelStatus: "ready", featureErrors: none }, "ready"],
    ["새 메시, busy", { meshPart: flange, kernelStatus: "busy", featureErrors: none }, "ready"],
    // 피처 하나의 오류는 나머지로 만든 메시가 있으므로 ready
    ["새 메시, 피처 오류", { meshPart: flange, kernelStatus: "ready", featureErrors: featureFail }, "ready"],
    // 커널 예외(featureId "*")로 끝난 평가: 메시는 옛 것이 남아 있으므로 fail
    ["새 메시, 커널 예외", { meshPart: flange, kernelStatus: "ready", featureErrors: kernelFail }, "fail"],
    // 옛 평가의 커널 예외는 새 평가가 끝나면 사라지므로 wait
    ["옛 메시, 커널 예외", { meshPart: other, kernelStatus: "ready", featureErrors: kernelFail }, "wait"],
    // 워커 죽음 → 즉시 fail (메시가 맞아 보여도)
    ["새 메시, error", { meshPart: flange, kernelStatus: "error", featureErrors: none }, "fail"],
    ["옛 메시, error", { meshPart: other, kernelStatus: "error", featureErrors: none }, "fail"],
    ["메시 없음, error", { meshPart: null, kernelStatus: "error", featureErrors: none }, "fail"],
  ] as const)("%s → %s", (_name, state, expected) => {
    expect(isCurrentState(state, matches)).toBe(expected);
  });

  it("텍스트가 없으면 메시가 무엇이든 ready (커널 오류는 예외)", () => {
    const any = prepareMatcher(undefined);
    expect(isCurrentState({ meshPart: null, kernelStatus: "ready", featureErrors: none }, any)).toBe("ready");
    expect(isCurrentState({ meshPart: other, kernelStatus: "busy", featureErrors: none }, any)).toBe("ready");
    expect(isCurrentState({ meshPart: flange, kernelStatus: "error", featureErrors: none }, any)).toBe("fail");
    expect(isCurrentState({ meshPart: flange, kernelStatus: "ready", featureErrors: kernelFail }, any)).toBe("fail");
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

  it("나중에 조건이 맞으면 true가 되고 구독과 타이머가 정리된다", async () => {
    vi.useFakeTimers();
    const store = fakeStore();
    let ok = false;
    const p = waitFor(() => ok, store.subscribe, 1000);
    expect(store.listeners.size).toBe(1);
    expect(vi.getTimerCount()).toBe(1);
    store.notify(); // 아직 아니다
    ok = true;
    store.notify();
    await expect(p).resolves.toBe(true);
    expect(store.listeners.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
    // 타이머가 이미 지워졌으므로 시간이 더 흘러도 아무 일도 없다
    vi.advanceTimersByTime(2000);
    expect(vi.getTimerCount()).toBe(0);
    await expect(p).resolves.toBe(true);
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

  it("구독 중에 동기적으로 알림이 와서 끝나면 그 구독도 푼다", async () => {
    vi.useFakeTimers();
    const store = fakeStore();
    let ok = false;
    const subscribe = (cb: () => void) => {
      const unsubscribe = store.subscribe(cb);
      cb(); // 구독 함수가 반환하기 전에 알림
      return unsubscribe;
    };
    const p = waitFor(
      () => {
        const v = ok;
        ok = true; // 첫 검사(즉시 경로)는 false, 구독 중 알림부터 true
        return v;
      },
      subscribe,
      1000,
    );
    await expect(p).resolves.toBe(true);
    expect(store.listeners.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });
});
