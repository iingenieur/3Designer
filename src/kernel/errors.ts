import { getOC } from "replicad";

type OCWithExceptions = { getExceptionMessage?: (e: unknown) => unknown };
type Ctor = abstract new (...args: never[]) => object;

/** TS lib에는 WebAssembly.Exception/RuntimeError 선언이 없거나 불완전해 런타임에서 꺼낸다. */
function wasmCtor(name: "Exception" | "RuntimeError"): Ctor | undefined {
  if (typeof WebAssembly === "undefined") return undefined;
  return (WebAssembly as unknown as Record<string, Ctor | undefined>)[name];
}

function isWasmException(e: unknown): boolean {
  const Exception = wasmCtor("Exception");
  return Exception !== undefined && e instanceof Exception;
}

/**
 * 커널 예외를 사람이 읽을 수 있는 메시지로 바꾼다.
 * OpenCascade 예외는 WebAssembly.Exception이라 String()으로는 "[object WebAssembly.Exception]"만 나오므로
 * OC.getExceptionMessage로 [타입, 메시지] 튜플을 꺼낸다.
 */
export function errorMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (isWasmException(e)) {
    try {
      const OC = getOC() as unknown as OCWithExceptions;
      const decoded = OC.getExceptionMessage?.(e);
      if (Array.isArray(decoded) && decoded.length >= 2) {
        const [type, msg] = decoded as [unknown, unknown];
        return `커널 오류 ${String(type)}: ${String(msg)}`;
      }
    } catch {
      // 해독 실패 시 아래 일반 메시지로 떨어진다
    }
    return "커널 연산 실패 (OpenCascade 예외)";
  }
  return `커널 연산 실패: ${String(e)}`;
}

/** WASM 런타임 자체가 망가진 경우(트랩, emscripten abort, 메모리 부족)인지 판별한다. 이때는 워커를 다시 띄워야 한다. */
export function isFatalKernelError(e: unknown): boolean {
  const RuntimeError = wasmCtor("RuntimeError");
  if (RuntimeError !== undefined && e instanceof RuntimeError) return true;
  return /Aborted\(|abort\(|out of memory/i.test(String(e));
}
