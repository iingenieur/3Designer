import { PartSchema, type Part } from "../model/schema";
import { compactPart } from "../model/edit";

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

/**
 * 뷰어가 보여주는 part가 파일 텍스트와 같은 모델인가. 기본값·키 순서 차이는 compactPart로 지운다.
 * (UI 편집은 compactPart로 저장되고 서버가 되돌려보내지 않으므로 텍스트 비교로는 안 된다.)
 * 텍스트가 없거나 파싱이 안 되면 true (기다릴 근거가 없으니 바로 찍는다).
 */
export function modelMatches(part: Part | null, text: string | undefined): boolean {
  if (text === undefined) return true;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return true;
  }
  const result = PartSchema.safeParse(parsed);
  if (!result.success) return true;
  if (!part) return false;
  return canonical(compactPart(part)) === canonical(compactPart(result.data));
}

/** 객체 키를 재귀적으로 정렬한 JSON 문자열. parameters 같은 record는 파일의 키 순서를 그대로 들고 있으므로 필요하다. */
function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, v: unknown) =>
    typeof v === "object" && v !== null && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
      : v,
  );
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
  });
}
