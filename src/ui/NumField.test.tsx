// @vitest-environment jsdom
import { describe, it, expect, beforeAll, afterEach } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { NumField } from "./NumField";
import type { Num } from "../model/schema";

beforeAll(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

const roots: Root[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.innerHTML = "";
});

function setup(value: Num, numberOnly = false) {
  const commits: Num[] = [];
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  roots.push(root);
  const render = (v: Num) =>
    act(() => root.render(<NumField label="h" value={v} numberOnly={numberOnly} onCommit={(x) => commits.push(x)} />));
  render(value);
  const input = host.querySelector("input")!;
  return { commits, input, render };
}

// React의 onChange는 네이티브 "input" 이벤트를 듣는다. 값 추적기가 알아채도록 네이티브 setter로 넣는다.
function type(input: HTMLInputElement, text: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  act(() => {
    setter.call(input, text);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function key(input: HTMLInputElement, k: string) {
  act(() => {
    input.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true }));
  });
}

describe("NumField", () => {
  it("Enter commits a number", () => {
    const { commits, input } = setup(10);
    act(() => input.focus());
    type(input, "99");
    key(input, "Enter");
    expect(commits).toEqual([99]);
    expect(document.activeElement).not.toBe(input);
  });

  it("Enter commits an expression string", () => {
    const { commits, input } = setup(10);
    act(() => input.focus());
    type(input, "D/2");
    key(input, "Enter");
    expect(commits).toEqual(["D/2"]);
  });

  it("Escape reverts and does not call onCommit", () => {
    const { commits, input } = setup(10);
    act(() => input.focus());
    type(input, "99");
    key(input, "Escape");
    expect(commits).toEqual([]);
    expect(input.value).toBe("10");
    // Esc 이후의 보통 blur 커밋은 다시 동작해야 한다
    act(() => input.focus());
    type(input, "11");
    key(input, "Enter");
    expect(commits).toEqual([11]);
  });

  it("numberOnly rejects an expression and resets the text", () => {
    const { commits, input } = setup(10, true);
    act(() => input.focus());
    type(input, "D/2");
    key(input, "Enter");
    expect(commits).toEqual([]);
    expect(input.value).toBe("10");
  });

  it("normalises numeric spelling without committing an equal value", () => {
    const { commits, input } = setup(10);
    act(() => input.focus());
    type(input, "010");
    key(input, "Enter");
    expect(commits).toEqual([]);
    expect(input.value).toBe("10");
  });

  it("external value change while focused does not overwrite typing; unfocused it does", () => {
    const { input, render } = setup(10);
    act(() => input.focus());
    type(input, "12");
    render(77);
    expect(input.value).toBe("12");
    act(() => input.blur()); // "12" !== "77"이므로 커밋되지만 여기서는 텍스트 동기화만 본다
    render(88);
    expect(input.value).toBe("88");
  });
});
