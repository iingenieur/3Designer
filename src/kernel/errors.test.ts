import { describe, it, expect, beforeAll } from "vitest";
import { makeBaseBox } from "replicad";
import { initKernelForNode } from "./node";
import { errorMessage, isFatalKernelError } from "./errors";

beforeAll(initKernelForNode);

describe("errorMessage", () => {
  it("returns the message of a plain Error", () => {
    expect(errorMessage(new Error("boom"))).toBe("boom");
  });

  it("stringifies non-Error values", () => {
    expect(errorMessage("oops")).toBe("커널 연산 실패: oops");
  });

  it("decodes an OpenCascade exception into type and message", () => {
    let caught: unknown = null;
    try {
      makeBaseBox(10, 10, 10).fillet(20);
    } catch (e) {
      caught = e;
    }
    const WasmException = (WebAssembly as unknown as { Exception: new () => object }).Exception;
    expect(caught).toBeInstanceOf(WasmException);
    const message = errorMessage(caught);
    expect(message).toContain("StdFail_NotDone");
    expect(message).toContain("BRep_API");
    expect(message).not.toContain("[object");
  });
});

describe("isFatalKernelError", () => {
  it("treats a WebAssembly.RuntimeError as fatal", () => {
    expect(isFatalKernelError(new WebAssembly.RuntimeError("unreachable"))).toBe(true);
  });

  it("treats an emscripten abort as fatal", () => {
    expect(isFatalKernelError(new Error("Aborted(OOM)"))).toBe(true);
  });

  it("treats an ordinary kernel failure as non-fatal", () => {
    expect(isFatalKernelError(new Error("BRep_API: command not done"))).toBe(false);
    expect(isFatalKernelError("StdFail_NotDone")).toBe(false);
  });
});
