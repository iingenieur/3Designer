import { PartSchema, type Part } from "../model/schema";

let capture: (() => string) | null = null;

/** Viewport가 마운트될 때 캔버스 캡처 함수를 등록한다. 언마운트 때 null. */
export function registerCapture(fn: (() => string) | null) {
  capture = fn;
}

/** 현재 화면을 PNG data URL로. 뷰포트가 없으면 던진다. */
export function captureScreenshot(): string {
  if (!capture) throw new Error("뷰포트가 아직 준비되지 않았습니다.");
  return capture();
}

/** 뷰어의 Part가 요청의 파일 텍스트와 같은 모델인지 판정하는 함수 */
export type Matcher = (part: Part | null) => boolean;

/**
 * 파일 텍스트를 한 번만 파싱해 비교 함수를 만든다 (대기 중 통지마다 다시 파싱하지 않는다).
 * 텍스트가 없거나 파싱·스키마 검증이 안 되면 항상 true (기다릴 근거가 없으니 바로 찍는다).
 * 양쪽 모두 Zod 출력이라 기본값이 채워져 있으므로 키 순서만 정규화해 비교한다.
 * (UI 편집은 compactPart로 저장되고 서버가 되돌려보내지 않으므로 원문 텍스트 비교로는 안 된다.)
 */
export function prepareMatcher(text: string | undefined): Matcher {
  if (text === undefined) return () => true;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return () => true;
  }
  const result = PartSchema.safeParse(parsed);
  if (!result.success) return () => true;
  const target = canonical(result.data);
  return (part) => part !== null && canonical(part) === target;
}

/** 객체 키를 재귀적으로 정렬한 JSON 문자열. parameters 같은 record는 파일의 키 순서를 그대로 들고 있으므로 필요하다. */
function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, v: unknown) =>
    typeof v === "object" && v !== null && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
      : v,
  );
}

export type CurrentState = "ready" | "wait" | "fail";

/**
 * 지금 캡처해도 되는가.
 * - fail: 커널 워커가 죽어(재시작 포기) 화면의 메시가 어느 모델의 것인지 보장할 수 없다.
 * - ready: 화면의 메시(meshPart)가 요청한 모델의 것이다. kernelStatus는 보지 않는다 —
 *   set({part}) 직후 통지에서는 busy가 아직 아니고, 워커 ready 보고가 busy를 덮어쓸 수도 있어 믿을 수 없다.
 * - wait: 아직 그 모델의 평가가 끝나지 않았다.
 */
export function isCurrentState(state: { meshPart: Part | null; kernelStatus: string }, matches: Matcher): CurrentState {
  if (state.kernelStatus === "error") return "fail";
  return matches(state.meshPart) ? "ready" : "wait";
}

/**
 * isCurrent가 참이 될 때까지 구독으로 기다린다. 이미 참이면 구독 없이 즉시 true,
 * timeoutMs 안에 참이 되지 않으면 false. 어느 쪽이든 끝나면 구독과 타이머를 정리하고 한 번만 resolve한다.
 */
export function waitFor(
  isCurrent: () => boolean,
  subscribe: (cb: () => void) => () => void,
  timeoutMs: number,
): Promise<boolean> {
  if (isCurrent()) return Promise.resolve(true);
  return new Promise((resolve) => {
    let settled = false;
    let unsubscribe: (() => void) | null = null;
    const done = (v: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      unsubscribe?.();
      resolve(v);
    };
    const timer = setTimeout(() => done(false), timeoutMs);
    unsubscribe = subscribe(() => {
      if (!settled && isCurrent()) done(true);
    });
    // subscribe가 반환하기 전에 동기 알림으로 끝났으면 done이 구독을 풀지 못했다
    if (settled) unsubscribe();
  });
}
