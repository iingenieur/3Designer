# 3Designer M5 MCP 서버 구현 계획

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Claude Code가 파일을 손으로 고치는 대신 이름 붙은 MCP 도구로 모델을 읽고·검증하고·편집하고, 커널 검증 결과(오류·치수·부피)와 뷰어 스크린샷을 즉시 돌려받게 한다.

**Architecture:** `server/mcp.ts`는 Claude Code가 stdio로 띄우는 별도 프로세스다(`.mcp.json`). 검증은 **Node 안에서 replicad를 직접 실행**해 브라우저 없이도 동작한다(초기화 약 0.1~1초, 플랜지 평가 약 0.2초). 스크린샷만 브라우저가 필요하므로 MCP 프로세스가 기존 파일 감시 서버(ws://localhost:5174)에 "에이전트" 클라이언트로 붙고, 서버가 요청을 뷰어로 중계한다. 편집 도구는 `src/model/edit.ts`의 순수 함수를 재사용해 파일에 쓰고, 파일 감시가 뷰어를 갱신하는 기존 경로를 그대로 탄다. 파일은 여전히 유일한 진실의 원천이다.

**Tech Stack:** 기존 스택 + `@modelcontextprotocol/sdk` 1.32.1 (`McpServer`, `StdioServerTransport`, 테스트는 `InMemoryTransport`·`StdioClientTransport`). 스키마는 Zod 4 그대로.

설계 문서: `docs/plans/2026-10-13-3designer-design.md` (M5 행). 이전 계획: `docs/plans/2026-10-13-3designer-m1-m4.md`.

---

## 사전 검증된 사실 (2026-10-14, 직접 실행해 확인)

- `@modelcontextprotocol/sdk@1.32.1`은 `zod ^4`를 peer로 받는다. `registerTool(name, { description, inputSchema: { a: z.string() } }, async (args) => ({ content: [...] }))` 형태. 인자 검증 실패는 SDK가 `isError: true` + "MCP error -32602: Input validation error: ..." 텍스트로 돌려주고, 콜백이 `throw new Error("x")` 하면 `{ content: [{ type: "text", text: "x" }], isError: true }`가 된다.
- 이미지 응답: `{ type: "image", data: <base64>, mimeType: "image/png" }`. `data`는 data URL 접두어(`data:image/png;base64,`) **없이** base64만.
- `registerResource("schema", "doc://3designer/schema", { description, mimeType }, async (uri) => ({ contents: [{ uri: uri.href, text, mimeType }] }))`. **URI 스킴은 숫자로 시작할 수 없다** (`3designer://`는 `new URL`에서 Invalid URL). `doc://3designer/schema`를 쓴다.
- import 경로: `@modelcontextprotocol/sdk/server/mcp.js`, `@modelcontextprotocol/sdk/server/stdio.js`, `@modelcontextprotocol/sdk/client/index.js`, `@modelcontextprotocol/sdk/client/stdio.js`, `@modelcontextprotocol/sdk/inMemory.js` (`InMemoryTransport.createLinkedPair()`).
- Node에서 커널: `initKernel(require.resolve("replicad-opencascadejs/wasm"))`(현재 `src/kernel/testSetup.ts`) → `evaluateFeatures(resolved)`가 `{ shape, errors }`. 초기화 133ms, 플랜지 평가 196ms, 실패하는 필렛 55ms. **stdout에는 아무것도 찍지 않는다** (확인함). 그래도 MCP 프로세스는 `console.log`를 stderr로 돌려 stdio 전송을 보호한다.
- 필렛 반경 50인 플랜지 → `{ featureId: "edge", stage: "kernel", message: "커널 오류 StdFail_NotDone: BRep_API: command not done" }`. 플랜지 bounds `[[-20,-20,0],[20,20,14]]`.
- 경로 상대 import: 스크래치 폴더에서 `.ts`는 CJS로 취급되어 top-level await가 안 된다. 프로젝트 안(`"type": "module"`)의 파일은 문제없다.

## 설계 결정

- **도구 8개** (이름은 영문, 설명은 한국어): `get_model`, `validate`, `write_model`, `set_parameter`, `add_feature`, `update_feature`, `delete_feature`, `screenshot`. 리소스 1개: `doc://3designer/schema` = `docs/schema.md`.
- **대상 파일**: 모든 도구에 선택 인자 `path`. 생략하면 감시 서버가 보내준 파일 경로(에이전트 연결의 `file` 메시지). 둘 다 없으면 오류 "path를 지정하거나 `npm start -- <모델>`로 서버를 먼저 켜세요".
- **편집 도구 공통 흐름**: 파일 읽기 → 스키마 파싱(실패면 편집 거부, 오류 반환) → 편집 함수 적용 → 검증 → **스키마 오류면 쓰지 않고** 오류 반환, 아니면 `compactPart`로 쓰고 커널 결과(피처 오류·치수·부피·경고) 반환. 수식/커널 오류는 파일에 써진다(사용자가 화면에서 보고, 에이전트가 응답으로 받아 고친다).
- **검증 결과 모양** `ValidationResult`: `{ ok, schema: SchemaError[], features: FeatureError[], measurements: { bounds, size, volume } | null, warnings: string[] }`. `warnings`는 프린트 적합성(바닥이 Z<0, 피처 없음). errors.json과 같은 `schema`/`features` 모양을 유지한다.
- **스크린샷 정합성**: 도구가 파일의 현재 텍스트를 요청에 실어 보내고, 뷰어는 자기 모델이 그 텍스트와 같은 모델이 될 때까지(`compactPart` 비교) + 커널이 busy가 아닐 때까지 기다렸다가 캡처한다(최대 8초). 스키마 오류가 있는 파일은 도구가 요청 전에 거부한다.
- **뷰어 식별**: 브라우저는 연결 직후 `{ kind: "hello", role: "viewer" }`를 보낸다. 서버는 viewer에게만 스크린샷 요청을 보내고, 없으면 즉시 실패를 돌려준다.
- `.mcp.json`을 저장소 루트에 둔다(Claude Code가 프로젝트 폴더에서 자동 인식, 첫 사용 때 승인). 다른 폴더에서 쓰려면 README의 `claude mcp add` 안내.
- `src/kernel/testSetup.ts` → `src/kernel/node.ts`로 이름을 바꾼다 (이제 프로덕션 코드가 쓴다).

---

## Task 1: Node 검증 모듈

**Files:**
- Rename: `src/kernel/testSetup.ts` → `src/kernel/node.ts` (import 4곳: `src/kernel/{toMesh,errors,examples,evaluate}.test.ts`)
- Create: `server/validate.ts`, `server/validate.test.ts`

**Step 1: 이름 변경**

`git mv src/kernel/testSetup.ts src/kernel/node.ts`. 파일 주석을 "Node(테스트·MCP 서버)에서 replicad를 초기화한다."로. 네 테스트의 import 경로를 `./node`로 고친다. `npm test -- src/kernel` 통과 확인.

**Step 2: 실패하는 테스트 작성** `server/validate.test.ts`

```ts
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { validatePart, parsePart } from "./validate";

const flange = readFileSync("examples/flange.3d.json", "utf8");

describe("parsePart", () => {
  it("JSON 문법 오류를 schema 오류로 돌려준다", () => {
    const r = parsePart("{ nope");
    expect(r.part).toBeNull();
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
  });
});

describe("validatePart", () => {
  it("플랜지는 ok이고 치수·부피가 있다", async () => {
    const r = await validatePart(flange);
    expect(r.ok).toBe(true);
    expect(r.schema).toEqual([]);
    expect(r.features).toEqual([]);
    expect(r.measurements?.bounds).toEqual([[-20, -20, 0], [20, 20, 14]]);
    expect(r.measurements?.size).toEqual([40, 40, 14]);
    expect(r.measurements?.volume).toBeGreaterThan(0);
    expect(r.warnings).toEqual([]);
  });
  it("스키마 오류면 커널을 돌리지 않는다", async () => {
    const r = await validatePart("{ nope");
    expect(r.ok).toBe(false);
    expect(r.schema.length).toBe(1);
    expect(r.measurements).toBeNull();
  });
  it("수식 오류는 features에 stage expression으로", async () => {
    const part = JSON.parse(flange);
    part.features[0].radius = "D /";
    const r = await validatePart(part);
    expect(r.ok).toBe(false);
    expect(r.features[0]).toMatchObject({ featureId: "body", stage: "expression" });
  });
  it("커널 오류는 features에 stage kernel로, 나머지 형상은 측정한다", async () => {
    const part = JSON.parse(flange);
    part.features[4].radius = 50;
    const r = await validatePart(part);
    expect(r.ok).toBe(false);
    expect(r.features[0]).toMatchObject({ featureId: "edge", stage: "kernel" });
    expect(r.measurements).not.toBeNull();
  });
  it("바닥이 Z=0 아래면 경고한다", async () => {
    const r = await validatePart({ version: 1, units: "mm", features: [{ id: "s", type: "sphere", radius: 5 }] });
    expect(r.ok).toBe(true);
    expect(r.warnings[0]).toMatch(/Z=0 아래/);
  });
  it("피처가 없으면 ok가 아니고 경고한다", async () => {
    const r = await validatePart({ version: 1, units: "mm", features: [] });
    expect(r.ok).toBe(false);
    expect(r.measurements).toBeNull();
    expect(r.warnings[0]).toMatch(/피처가 없/);
  });
});
```

**Step 3: 실행해 실패 확인** `npx vitest run server/validate.test.ts` → "Failed to resolve import ./validate".

**Step 4: 구현** `server/validate.ts`

```ts
import { createRequire } from "node:module";
import { measureVolume } from "replicad";
import { PartSchema, type Part } from "../src/model/schema";
import { resolvePart, type FeatureError } from "../src/model/resolve";
import { evaluateFeatures } from "../src/kernel/evaluate";
import { initKernel } from "../src/kernel/oc";

export interface SchemaError {
  path: string;
  message: string;
}

export interface Measurements {
  bounds: [[number, number, number], [number, number, number]];
  /** bounds의 가로·세로·높이 */
  size: [number, number, number];
  /** mm³ */
  volume: number;
}

/** 모델 하나의 검증 결과. `schema`·`features`는 `<파일>.errors.json`과 같은 모양이다. */
export interface ValidationResult {
  /** 오류가 하나도 없고 형상이 있다 */
  ok: boolean;
  schema: SchemaError[];
  features: FeatureError[];
  /** 형상이 있을 때만. 피처 오류가 있어도 나머지로 만든 형상을 잰다. */
  measurements: Measurements | null;
  /** 3D 프린팅 적합성 경고 */
  warnings: string[];
}

/** JSON 텍스트 또는 객체를 Part로 파싱한다. 실패하면 part는 null, schema에 이유. */
export function parsePart(raw: unknown): { part: Part | null; schema: SchemaError[] } {
  let value = raw;
  if (typeof raw === "string") {
    try {
      value = JSON.parse(raw);
    } catch (e) {
      return { part: null, schema: [{ path: "", message: `JSON 문법 오류: ${String(e)}` }] };
    }
  }
  const result = PartSchema.safeParse(value);
  if (!result.success) {
    return {
      part: null,
      schema: result.error.issues.map((i) => ({ path: i.path.map(String).join("."), message: i.message })),
    };
  }
  return { part: result.data, schema: [] };
}

const require = createRequire(import.meta.url);
let kernelReady: Promise<void> | null = null;
function ensureKernel(): Promise<void> {
  if (!kernelReady) kernelReady = initKernel(require.resolve("replicad-opencascadejs/wasm"));
  return kernelReady;
}

const round = (v: number) => Math.round(v * 1000) / 1000;

/** 스키마 → 수식 → 커널 순으로 검증하고 형상을 잰다. 커널은 첫 호출 때 초기화된다. */
export async function validatePart(raw: unknown): Promise<ValidationResult> {
  const { part, schema } = parsePart(raw);
  if (!part) return { ok: false, schema, features: [], measurements: null, warnings: [] };
  const warnings: string[] = [];
  if (part.features.length === 0) {
    warnings.push("피처가 없어 형상이 비어 있습니다.");
    return { ok: false, schema: [], features: [], measurements: null, warnings };
  }
  await ensureKernel();
  const { resolved, errors: exprErrors } = resolvePart(part);
  const { shape, errors: kernelErrors } = evaluateFeatures(resolved);
  const features = [...exprErrors, ...kernelErrors];
  let measurements: Measurements | null = null;
  if (shape) {
    const [min, max] = shape.boundingBox.bounds;
    const bounds: Measurements["bounds"] = [
      [round(min[0]), round(min[1]), round(min[2])],
      [round(max[0]), round(max[1]), round(max[2])],
    ];
    measurements = {
      bounds,
      size: [round(max[0] - min[0]), round(max[1] - min[1]), round(max[2] - min[2])],
      volume: round(measureVolume(shape)),
    };
    if (bounds[0][2] < -1e-6) {
      warnings.push(`바닥이 Z=0 아래로 내려갑니다 (최저 Z = ${bounds[0][2]}). 베드에 놓이도록 올리세요.`);
    }
  } else if (features.length === 0) {
    warnings.push("형상이 비어 있습니다 (모든 피처가 꺼져 있거나 컷만 있음).");
  }
  return { ok: features.length === 0 && shape !== null, schema: [], features, measurements, warnings };
}
```

`src/kernel/node.ts`의 `initKernelForNode`를 여기서 써도 된다 — 중복이면 `validate.ts`가 `initKernelForNode()`를 호출하고 `ensureKernel`을 없앤다. (`initKernel` 자체가 한 번만 초기화하므로 둘 다 안전.)

**Step 5: 통과 확인** `npx vitest run server/validate.test.ts` → 9 passed. `npm run typecheck`.

**Step 6: 커밋** `feat(server): Node 검증 모듈 (스키마·수식·커널·측정·프린트 경고)`

---

## Task 2: 스크린샷 중계 프로토콜과 서버

**Files:**
- Modify: `server/protocol.ts`
- Create: `server/relay.ts`, `server/relay.test.ts`
- Modify: `server/index.ts`

**Step 1: 프로토콜 확장** `server/protocol.ts`

```ts
/** 서버 → 클라이언트(뷰어 또는 에이전트) */
export type ServerMessage =
  | { kind: "file"; path: string; text: string }
  | { kind: "fileError"; message: string }
  /** 뷰어에게: 지금 화면을 캡처해 달라. text는 캡처 전에 뷰어가 반영해야 할 파일 내용(없으면 즉시 캡처). */
  | { kind: "screenshotRequest"; id: number; text?: string }
  /** 에이전트에게: 요청 결과 */
  | { kind: "screenshot"; id: number; dataUrl: string }
  | { kind: "screenshotFailed"; id: number; message: string };

/**
 * 클라이언트 → 서버
 * - hello: 연결 직후 역할을 알린다. viewer만 스크린샷 요청을 받는다.
 * - save / errors: 뷰어 (M3~M4 설명은 이전과 같다)
 * - screenshotRequest: 에이전트. id는 에이전트가 정한 값이고 응답에 그대로 돌아온다.
 * - screenshot / screenshotFailed: 뷰어가 screenshotRequest에 답한다. id는 서버가 준 값.
 */
export type ClientMessage =
  | { kind: "hello"; role: "viewer" | "agent" }
  | { kind: "save"; part: unknown }
  | { kind: "errors"; errors: unknown }
  | { kind: "screenshotRequest"; id: number; text?: string }
  | { kind: "screenshot"; id: number; dataUrl: string }
  | { kind: "screenshotFailed"; id: number; message: string };
```

**Step 2: 실패하는 테스트** `server/relay.test.ts`

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ScreenshotRelay } from "./relay";
import type { ServerMessage } from "./protocol";

function fakeClient() {
  const sent: ServerMessage[] = [];
  return { sent, send: (m: ServerMessage) => void sent.push(m) };
}

describe("ScreenshotRelay", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("뷰어가 없으면 즉시 실패를 돌려준다", () => {
    const relay = new ScreenshotRelay(1000);
    const agent = fakeClient();
    relay.request(agent.send, 7, undefined);
    expect(agent.sent).toEqual([{ kind: "screenshotFailed", id: 7, message: expect.stringContaining("브라우저") }]);
  });

  it("뷰어에게 요청을 보내고 답을 에이전트 id로 돌려준다", () => {
    const relay = new ScreenshotRelay(1000);
    const viewer = fakeClient();
    const agent = fakeClient();
    relay.addViewer(viewer.send);
    relay.request(agent.send, 7, "{}");
    expect(viewer.sent).toHaveLength(1);
    const req = viewer.sent[0];
    expect(req).toMatchObject({ kind: "screenshotRequest", text: "{}" });
    relay.resolve((req as { id: number }).id, "data:image/png;base64,AAA");
    expect(agent.sent).toEqual([{ kind: "screenshot", id: 7, dataUrl: "data:image/png;base64,AAA" }]);
  });

  it("뷰어 실패를 전달한다", () => { /* reject → screenshotFailed with id 7 */ });

  it("시간이 지나면 실패로 끝내고 늦은 답은 무시한다", () => {
    // request, advanceTimersByTime(1000) → screenshotFailed(…시간…), resolve 후 agent.sent 길이 그대로
  });

  it("뷰어가 끊기면 그 뷰어에게 보낸 대기 요청은 실패한다", () => {
    // addViewer, request, removeClient(viewer.send) → screenshotFailed
  });

  it("에이전트가 끊기면 대기 요청을 버린다", () => {
    // request, removeClient(agent.send), resolve → agent.sent 비어 있음, 타이머가 남지 않음 (vi.getTimerCount() === 0)
  });

  it("두 뷰어면 첫 응답만 쓴다", () => {
    // 두 뷰어 모두에게 요청, 첫 resolve → agent에 하나, 둘째 resolve 무시
  });
});
```

**Step 3: 구현** `server/relay.ts`

```ts
import type { ServerMessage } from "./protocol";

export type Send = (message: ServerMessage) => void;

interface Pending {
  requester: Send;
  requesterId: number;
  viewers: Set<Send>;
  timer: ReturnType<typeof setTimeout>;
}

/**
 * 에이전트의 스크린샷 요청을 뷰어(브라우저)에 넘기고 답을 되돌린다.
 * 서버 내부 id로 요청을 추적하고, 에이전트에게는 에이전트가 준 id로 답한다.
 * 뷰어가 여럿이면 모두에게 보내고 첫 답을 쓴다. 뷰어가 없으면 즉시 실패.
 */
export class ScreenshotRelay {
  private viewers = new Set<Send>();
  private pending = new Map<number, Pending>();
  private seq = 0;

  constructor(private readonly timeoutMs = 10_000) {}

  addViewer(send: Send) { this.viewers.add(send); }

  /** 뷰어든 에이전트든 연결이 끊겼을 때 */
  removeClient(send: Send) {
    this.viewers.delete(send);
    for (const [id, p] of this.pending) {
      if (p.requester === send) this.drop(id);
      else if (p.viewers.has(send)) { p.viewers.delete(send); if (p.viewers.size === 0) this.fail(id, "브라우저 연결이 끊겼습니다."); }
    }
  }

  request(requester: Send, requesterId: number, text: string | undefined) {
    if (this.viewers.size === 0) {
      requester({ kind: "screenshotFailed", id: requesterId, message: "브라우저(뷰어)가 연결되어 있지 않습니다. http://localhost:5173 을 여세요." });
      return;
    }
    const id = ++this.seq;
    const timer = setTimeout(() => this.fail(id, `뷰어가 ${this.timeoutMs / 1000}초 안에 응답하지 않았습니다.`), this.timeoutMs);
    this.pending.set(id, { requester, requesterId, viewers: new Set(this.viewers), timer });
    for (const v of this.viewers) v({ kind: "screenshotRequest", id, text });
  }

  resolve(id: number, dataUrl: string) {
    const p = this.drop(id);
    if (p) p.requester({ kind: "screenshot", id: p.requesterId, dataUrl });
  }

  reject(id: number, message: string) { this.fail(id, message); }

  private fail(id: number, message: string) {
    const p = this.drop(id);
    if (p) p.requester({ kind: "screenshotFailed", id: p.requesterId, message });
  }

  private drop(id: number): Pending | undefined {
    const p = this.pending.get(id);
    if (!p) return undefined;
    clearTimeout(p.timer);
    this.pending.delete(id);
    return p;
  }
}
```

**Step 4: 테스트 통과 확인.** 7 passed.

**Step 5: 서버 배선** `server/index.ts`

- `const relay = new ScreenshotRelay();`
- 연결마다 안정된 `send` 하나: `const send: Send = (m) => { if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(m)); };` (`sendFile(socket)`도 이 `send`를 쓰도록 `sendFile(send?: Send)`로 바꾼다.)
- message 분기 추가: `hello` → `role === "viewer"`면 `relay.addViewer(send)`, 콘솔에 "뷰어 연결" / "에이전트 연결"; `screenshotRequest` → `relay.request(send, m.id, m.text)`; `screenshot` → `relay.resolve(m.id, m.dataUrl)`; `screenshotFailed` → `relay.reject(m.id, m.message)`.
- `socket.on("close", () => relay.removeClient(send))`.
- `file` 브로드캐스트는 지금처럼 모든 클라이언트에게 간다(에이전트도 경로를 알기 위해 받는다).

**Step 6: 수동 확인.** `npm run serve -- examples/flange.3d.json`을 띄우고 `npx tsx -e`로 ws 클라이언트가 `hello agent` → `screenshotRequest`를 보내면 "브라우저가 연결되어 있지 않습니다" 실패가 돌아오는지 본다. 서버 종료.

**Step 7: typecheck 후 커밋** `feat(server): 스크린샷 중계 (hello 역할, ScreenshotRelay)`

---

## Task 3: 뷰어의 hello와 스크린샷 캡처

**Files:**
- Create: `src/state/screenshot.ts`, `src/state/screenshot.test.ts`
- Modify: `src/state/store.ts`, `src/ui/Viewport.tsx`

**Step 1: 캡처 등록소 + 정합성 판단 (순수 부분을 테스트)** `src/state/screenshot.ts`

```ts
import { PartSchema, type Part } from "../model/schema";
import { compactPart } from "../model/edit";

let capture: (() => string) | null = null;

/** Viewport가 마운트될 때 캔버스 캡처 함수를 등록한다. 언마운트 때 null. */
export function registerCapture(fn: (() => string) | null) { capture = fn; }

/** 현재 화면을 PNG data URL로. 뷰포트가 없으면 던진다. */
export function captureScreenshot(): string {
  if (!capture) throw new Error("뷰포트가 아직 준비되지 않았습니다.");
  return capture();
}

/**
 * 뷰어가 보여주는 part가 파일 텍스트와 같은 모델인가. 기본값·키 순서 차이는 compactPart로 지운다.
 * 텍스트가 없거나 파싱이 안 되면 true (기다릴 근거가 없으니 바로 찍는다).
 */
export function modelMatches(part: Part | null, text: string | undefined): boolean {
  if (text === undefined) return true;
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch { return true; }
  const result = PartSchema.safeParse(parsed);
  if (!result.success) return true;
  if (!part) return false;
  return JSON.stringify(compactPart(part)) === JSON.stringify(compactPart(result.data));
}
```

테스트 `src/state/screenshot.test.ts`: `modelMatches` — 같은 모델이면 true, 파라미터가 다르면 false, 기본값(`"op": "add"`) 명시 여부만 다르면 true, 텍스트 undefined면 true, 깨진 JSON이면 true, part null이면 false. `captureScreenshot` — 등록 전엔 던지고 등록 후엔 값을 돌려준다.

**Step 2: 스토어** `src/state/store.ts`

- `Connection` 메시지 콜백을 `switch (m.kind)`로 바꾼다: `file`, `fileError`, `screenshotRequest` → `void handleScreenshot(m.id, m.text)`. (`screenshot`/`screenshotFailed`는 뷰어에게 오지 않으므로 무시.)
- 상태 콜백: `status === "open"`이면 `connection.send({ kind: "hello", role: "viewer" })`를 먼저 보낸다.
- `handleScreenshot`:

```ts
const SCREENSHOT_WAIT_MS = 8000;
/** 파일 텍스트의 모델이 화면에 반영되고 커널이 쉬는 상태가 될 때까지 기다린다. 시간이 넘으면 false. */
function waitUntilCurrent(text: string | undefined): Promise<boolean> {
  const isCurrent = () => get().kernelStatus !== "busy" && modelMatches(get().part, text);
  if (isCurrent()) return Promise.resolve(true);
  return new Promise((resolve) => {
    const unsubscribe = useStore.subscribe(() => { if (isCurrent()) { done(true); } });
    const timer = setTimeout(() => done(false), SCREENSHOT_WAIT_MS);
    function done(v: boolean) { clearTimeout(timer); unsubscribe(); resolve(v); }
  });
}
async function handleScreenshot(id: number, text: string | undefined) {
  if (!(await waitUntilCurrent(text))) {
    connection.send({ kind: "screenshotFailed", id, message: "뷰어가 최신 모델을 아직 반영하지 못했습니다 (커널 오류나 스키마 오류를 확인하세요)." });
    return;
  }
  try {
    connection.send({ kind: "screenshot", id, dataUrl: captureScreenshot() });
  } catch (e) {
    connection.send({ kind: "screenshotFailed", id, message: e instanceof Error ? e.message : String(e) });
  }
}
```

`useStore`는 `create()` 결과이므로 콜백 안에서 참조해도 된다(지연 평가). `subscribe`는 Zustand 5 기본 API.

**Step 3: 뷰포트** `src/ui/Viewport.tsx`

```tsx
function ScreenshotBridge() {
  const { gl, scene, camera } = useThree();
  useEffect(() => {
    // preserveDrawingBuffer 없이도 toDataURL 직전에 한 번 그리면 버퍼가 살아 있다
    registerCapture(() => { gl.render(scene, camera); return gl.domElement.toDataURL("image/png"); });
    return () => registerCapture(null);
  }, [gl, scene, camera]);
  return null;
}
```
`<Canvas>` 안에 `<ScreenshotBridge />` 추가.

**Step 4: 테스트·typecheck·빌드.** `npm test`, `npm run typecheck`, `npm run build`.

**Step 5: 커밋** `feat(viewer): hello 역할 전송과 스크린샷 캡처 (최신 모델 반영 대기)`

---

## Task 4: MCP 서버 본체 (도구 8개 + 리소스)

**Files:**
- Create: `server/mcpServer.ts`, `server/mcpServer.test.ts`

**Step 1: 실패하는 테스트** `server/mcpServer.test.ts` — InMemoryTransport로 진짜 SDK 경로를 탄다.

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync, rmSync, copyFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createMcpServer, type McpDeps } from "./mcpServer";

let dir: string; let file: string; let client: Client; let deps: McpDeps;

function textOf(result: unknown): string { return (result as { content: { type: string; text?: string }[] }).content.find((c) => c.type === "text")?.text ?? ""; }
function jsonOf(result: unknown) { return JSON.parse(textOf(result)); }
async function call(name: string, args: Record<string, unknown> = {}) { return client.callTool({ name, arguments: args }); }

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "3designer-mcp-"));
  file = join(dir, "flange.3d.json");
  copyFileSync("examples/flange.3d.json", file);
  deps = {
    defaultPath: () => file,
    screenshot: async () => "data:image/png;base64,iVBORw0KGgo=",
    schemaDoc: () => "# 스키마",
  };
  const server = createMcpServer(deps);
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(a);
  client = new Client({ name: "test", version: "0" });
  await client.connect(b);
});
afterEach(async () => { await client.close(); rmSync(dir, { recursive: true, force: true }); });

describe("도구 목록", () => {
  it("도구 8개와 리소스 1개", async () => {
    const names = (await client.listTools()).tools.map((t) => t.name).sort();
    expect(names).toEqual(["add_feature", "delete_feature", "get_model", "screenshot", "set_parameter", "update_feature", "validate", "write_model"]);
    expect((await client.listResources()).resources[0].uri).toBe("doc://3designer/schema");
    expect((await client.readResource({ uri: "doc://3designer/schema" })).contents[0].text).toBe("# 스키마");
  });
});

describe("get_model", () => {
  it("기본 경로의 모델을 돌려준다", async () => {
    const r = jsonOf(await call("get_model"));
    expect(r.path).toBe(file);
    expect(r.model.parameters.D).toBe(40);
    expect(r.model.features).toHaveLength(5);
  });
  it("path 인자가 우선한다", async () => { /* 다른 파일 복사 후 path 지정 */ });
  it("기본 경로가 없으면 오류", async () => {
    deps.defaultPath = () => null;
    const r = await call("get_model");
    expect(r.isError).toBe(true);
    expect(textOf(r)).toMatch(/npm start/);
  });
  it("파일에 스키마 오류가 있어도 원문과 오류를 돌려준다", async () => {
    writeFileSync(file, '{"version":1,"units":"mm","features":[{"id":"a","type":"box"}]}');
    const r = jsonOf(await call("get_model"));
    expect(r.schema[0].path).toBe("features.0.size");
  });
});

describe("validate", () => {
  it("파일을 검증한다", async () => {
    const r = jsonOf(await call("validate"));
    expect(r.ok).toBe(true);
    expect(r.measurements.size).toEqual([40, 40, 14]);
  });
  it("model 인자가 있으면 파일을 건드리지 않고 그것을 검증한다", async () => {
    const model = JSON.parse(readFileSync(file, "utf8"));
    model.features[4].radius = 50;
    const before = readFileSync(file, "utf8");
    const r = jsonOf(await call("validate", { model }));
    expect(r.ok).toBe(false);
    expect(r.features[0].featureId).toBe("edge");
    expect(readFileSync(file, "utf8")).toBe(before);
  });
});

describe("write_model", () => {
  it("스키마 오류면 쓰지 않고 isError", async () => {
    const before = readFileSync(file, "utf8");
    const r = await call("write_model", { model: { version: 1, units: "mm", features: [{ id: "a", type: "box" }] } });
    expect(r.isError).toBe(true);
    expect(jsonOf(r).schema[0].path).toBe("features.0.size");
    expect(readFileSync(file, "utf8")).toBe(before);
  });
  it("통과하면 compact 형식으로 쓰고 결과를 돌려준다", async () => {
    const model = JSON.parse(readFileSync(file, "utf8"));
    model.parameters.D = 50;
    model.features[0].op = "add"; // 기본값 → 저장 시 빠져야 한다
    const r = jsonOf(await call("write_model", { model }));
    expect(r.ok).toBe(true);
    expect(r.measurements.size[0]).toBe(50);
    const written = readFileSync(file, "utf8");
    expect(written.endsWith("\n")).toBe(true);
    expect(written).not.toContain('"op": "add"');
    expect(JSON.parse(written).parameters.D).toBe(50);
  });
  it("커널 오류가 있어도 쓰되 isError 없이 features로 알린다", async () => { /* radius 50 → 파일에 써짐, ok false */ });
});

describe("편집 도구", () => {
  it("set_parameter", async () => {
    const r = jsonOf(await call("set_parameter", { name: "D", value: 60 }));
    expect(r.ok).toBe(true);
    expect(JSON.parse(readFileSync(file, "utf8")).parameters.D).toBe(60);
  });
  it("add_feature는 끝에 붙이고 index가 있으면 그 자리에", async () => {
    await call("add_feature", { feature: { id: "top", type: "chamfer", name: "모따기", distance: 0.5, edges: "top" } });
    let ids = JSON.parse(readFileSync(file, "utf8")).features.map((f: { id: string }) => f.id);
    expect(ids.at(-1)).toBe("top");
    await call("add_feature", { feature: { id: "base", type: "box", size: [60, 60, 2] }, index: 0 });
    ids = JSON.parse(readFileSync(file, "utf8")).features.map((f: { id: string }) => f.id);
    expect(ids[0]).toBe("base");
  });
  it("add_feature 중복 id는 스키마 오류로 거부", async () => {
    const r = await call("add_feature", { feature: { id: "body", type: "box", size: [1, 1, 1] } });
    expect(r.isError).toBe(true);
    expect(textOf(r)).toMatch(/id 중복/);
  });
  it("update_feature는 얕게 병합하고 없는 id는 오류", async () => {
    const r = jsonOf(await call("update_feature", { id: "bolts", patch: { positions: { pattern: "circular", count: 6, diameter: "boltPCD" } } }));
    expect(r.ok).toBe(true);
    expect(JSON.parse(readFileSync(file, "utf8")).features[3].positions.count).toBe(6);
    expect((await call("update_feature", { id: "nope", patch: {} })).isError).toBe(true);
  });
  it("update_feature로 suppressed를 켤 수 있다", async () => { /* patch { suppressed: true } → 파일에 true */ });
  it("delete_feature", async () => {
    const r = jsonOf(await call("delete_feature", { id: "edge" }));
    expect(r.ok).toBe(true);
    expect(JSON.parse(readFileSync(file, "utf8")).features).toHaveLength(4);
    expect((await call("delete_feature", { id: "nope" })).isError).toBe(true);
  });
  it("파일에 스키마 오류가 있으면 편집을 거부한다", async () => {
    writeFileSync(file, "{ nope");
    const r = await call("set_parameter", { name: "D", value: 1 });
    expect(r.isError).toBe(true);
    expect(textOf(r)).toMatch(/write_model/);
  });
});

describe("screenshot", () => {
  it("이미지와 측정값을 돌려준다", async () => {
    const r = await call("screenshot");
    const content = (r as { content: { type: string; mimeType?: string; data?: string }[] }).content;
    const img = content.find((c) => c.type === "image");
    expect(img).toMatchObject({ mimeType: "image/png", data: "iVBORw0KGgo=" });
    expect(jsonOf(r).measurements.size).toEqual([40, 40, 14]);
  });
  it("스키마 오류가 있으면 요청하지 않는다", async () => {
    writeFileSync(file, "{ nope");
    let called = false;
    deps.screenshot = async () => { called = true; return ""; };
    expect((await call("screenshot")).isError).toBe(true);
    expect(called).toBe(false);
  });
  it("뷰어 실패를 isError로 전달한다", async () => {
    deps.screenshot = async () => { throw new Error("브라우저(뷰어)가 연결되어 있지 않습니다."); };
    const r = await call("screenshot");
    expect(r.isError).toBe(true);
    expect(textOf(r)).toMatch(/브라우저/);
  });
});
```

`deps`는 객체를 공유하므로 테스트 안에서 `deps.screenshot = ...`처럼 바꾸면 서버가 그것을 본다(`createMcpServer`는 호출 시점에 메서드를 복사하지 말고 `deps.x()`로 매번 읽는다).

**Step 2: 구현** `server/mcpServer.ts`

```ts
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { validatePart, parsePart, type ValidationResult } from "./validate";
import * as edit from "../src/model/edit";
import type { Part, Feature } from "../src/model/schema";

export interface McpDeps {
  /** 감시 서버가 알려준 현재 모델 파일. 모르면 null. */
  defaultPath: () => string | null;
  /** 뷰어 스크린샷을 PNG data URL로. text는 뷰어가 먼저 반영해야 할 파일 내용. 실패하면 던진다. */
  screenshot: (text: string) => Promise<string>;
  /** docs/schema.md 내용 */
  schemaDoc: () => string;
}

const pathArg = z.string().optional().describe("모델 파일 경로(*.3d.json). 생략하면 npm start로 띄운 서버가 감시 중인 파일.");
const modelArg = z.record(z.string(), z.unknown()).describe("모델 전체 객체. 형식은 리소스 doc://3designer/schema (docs/schema.md).");

const NO_PATH = "path를 지정하거나 `npm start -- <모델>.3d.json`으로 서버를 먼저 켜세요.";

function text(value: unknown): CallToolResult { return { content: [{ type: "text", text: JSON.stringify(value, null, 1) }] }; }
function fail(value: unknown): CallToolResult { return { ...text(value), isError: true }; }
function publicResult(r: ValidationResult) { return r; } // 지금은 그대로. 필드를 숨길 일이 생기면 여기서.

export function createMcpServer(deps: McpDeps): McpServer {
  const server = new McpServer({ name: "3designer", version: "0.1.0" });

  function resolvePath(path: string | undefined): string {
    const p = path ?? deps.defaultPath();
    if (!p) throw new Error(NO_PATH);
    return resolve(p);
  }
  function readText(path: string): string {
    try { return readFileSync(path, "utf8"); } catch (e) { throw new Error(`파일을 읽을 수 없습니다: ${path} (${(e as Error).message})`); }
  }
  function write(path: string, part: Part) { writeFileSync(path, JSON.stringify(edit.compactPart(part), null, 2) + "\n"); }

  /** 검증하고, 스키마 오류가 없으면 쓴다. 쓰지 않았으면 isError. */
  async function validateAndWrite(path: string, candidate: unknown): Promise<CallToolResult> {
    const result = await validatePart(candidate);
    if (result.schema.length > 0) return fail({ written: false, ...result });
    write(path, parsePart(candidate).part!);
    return text({ written: true, path, ...result });
  }

  /** 현재 파일을 읽어 편집 함수를 적용한 뒤 validateAndWrite. 파일이 깨져 있으면 거부. */
  async function editFile(path: string | undefined, fn: (part: Part) => Part): Promise<CallToolResult> {
    const p = resolvePath(path);
    const { part, schema } = parsePart(readText(p));
    if (!part) return fail({ written: false, message: "현재 파일에 스키마 오류가 있어 편집할 수 없습니다. validate로 확인하고 write_model로 고치세요.", schema });
    return validateAndWrite(p, edit.compactPart(fn(part)));
  }

  server.registerTool("get_model", {
    description: "현재 모델 파일을 읽는다. 편집 전에 항상 먼저 호출해 최신 상태(사용자가 UI에서 바꿨을 수 있음)를 본다.",
    inputSchema: { path: pathArg },
  }, async ({ path }) => {
    const p = resolvePath(path);
    const raw = readText(p);
    const { part, schema } = parsePart(raw);
    return text(part ? { path: p, model: edit.compactPart(part) } : { path: p, schema, raw });
  });

  server.registerTool("validate", {
    description: "모델을 검증한다(스키마 → 수식 → 커널). model을 주면 파일을 건드리지 않고 그 모델을 검증한다(쓰기 전 시험용). 오류·치수·부피·프린트 경고를 돌려준다.",
    inputSchema: { path: pathArg, model: modelArg.optional() },
  }, async ({ path, model }) => text(publicResult(await validatePart(model ?? readText(resolvePath(path))))));

  server.registerTool("write_model", {
    description: "모델 전체를 검증 후 파일에 쓴다. 스키마 오류면 쓰지 않는다. 수식·커널 오류는 쓰되 features로 알리니 고쳐서 다시 쓴다.",
    inputSchema: { model: modelArg, path: pathArg },
  }, async ({ model, path }) => validateAndWrite(resolvePath(path), model));

  server.registerTool("set_parameter", {
    description: "parameters의 변수 하나를 바꾼다(숫자만). 치수 변경은 피처를 고치지 말고 이것을 먼저 쓴다.",
    inputSchema: { name: z.string(), value: z.number(), path: pathArg },
  }, async ({ name, value, path }) => editFile(path, (part) => edit.setParameter(part, name, value)));

  server.registerTool("add_feature", {
    description: "피처를 추가한다. index를 주면 그 위치(0부터), 없으면 끝. id는 유일해야 한다.",
    inputSchema: { feature: z.record(z.string(), z.unknown()).describe("피처 객체. 예: {\"id\":\"lid\",\"type\":\"box\",\"name\":\"뚜껑\",\"size\":[40,40,2]}"), index: z.number().int().min(0).optional(), path: pathArg },
  }, async ({ feature, index, path }) => editFile(path, (part) => {
    const features = [...part.features];
    features.splice(index ?? features.length, 0, feature as Feature);
    return { ...part, features };
  }));

  server.registerTool("update_feature", {
    description: "id가 일치하는 피처에 patch를 얕게 병합한다(type 변경 불가). suppressed: true로 끌 수 있다.",
    inputSchema: { id: z.string(), patch: z.record(z.string(), z.unknown()), path: pathArg },
  }, async ({ id, patch, path }) => editFile(path, (part) => {
    if (!part.features.some((f) => f.id === id)) throw new Error(`피처가 없습니다: ${id}`);
    return edit.updateFeature(part, id, patch as edit.FeaturePatch);
  }));

  server.registerTool("delete_feature", {
    description: "id가 일치하는 피처를 지운다.",
    inputSchema: { id: z.string(), path: pathArg },
  }, async ({ id, path }) => editFile(path, (part) => {
    if (!part.features.some((f) => f.id === id)) throw new Error(`피처가 없습니다: ${id}`);
    return edit.deleteFeature(part, id);
  }));

  server.registerTool("screenshot", {
    description: "브라우저 뷰어의 현재 3D 화면을 PNG로 받는다. 편집 결과를 눈으로 확인할 때 쓴다. 브라우저(http://localhost:5173)가 열려 있어야 한다.",
    inputSchema: { path: pathArg },
  }, async ({ path }) => {
    const p = resolvePath(path);
    const raw = readText(p);
    const result = await validatePart(raw);
    if (result.schema.length > 0) return fail({ message: "스키마 오류가 있어 뷰어가 이 모델을 보여줄 수 없습니다.", ...result });
    const dataUrl = await deps.screenshot(raw);
    const base64 = dataUrl.replace(/^data:image\/png;base64,/, "");
    return { content: [{ type: "image", data: base64, mimeType: "image/png" }, { type: "text", text: JSON.stringify(publicResult(result), null, 1) }] };
  });

  server.registerResource("schema", "doc://3designer/schema", { description: "모델 파일(*.3d.json) 스키마 설명", mimeType: "text/markdown" },
    async (uri) => ({ contents: [{ uri: uri.href, text: deps.schemaDoc(), mimeType: "text/markdown" }] }));

  return server;
}
```

주의: `editFile` 안에서 `fn`이 던지면(없는 id) SDK가 `isError`로 바꿔 준다. `feature as Feature`는 검증 전 캐스팅이지만 바로 `compactPart` → `validatePart`(PartSchema)로 가므로 잘못된 피처는 스키마 오류로 거부된다. 단 `compactPart`가 검증 전 객체를 받으므로 `name`이 없는 피처 등 입력 모양이 느슨해도 터지지 않는지 확인한다(`withoutDefaults`는 어떤 객체든 받음).

**Step 3: 테스트 통과·typecheck.** `npx vitest run server/mcpServer.test.ts`.

**Step 4: 커밋** `feat(mcp): MCP 서버 본체 — 도구 8개, 스키마 리소스`

---

## Task 5: 진입점·에이전트 연결·.mcp.json·stdio E2E

**Files:**
- Create: `server/agentConnection.ts`, `server/mcp.ts`, `server/mcp.e2e.test.ts`, `.mcp.json`
- Modify: `package.json` (script `"mcp": "tsx server/mcp.ts"`), `vitest.config.ts` (필요 시 e2e 타임아웃)

**Step 1: 에이전트 연결** `server/agentConnection.ts`

```ts
import WebSocket from "ws";
import type { ClientMessage, ServerMessage } from "./protocol";

const RECONNECT_MS = 2000;
const SCREENSHOT_TIMEOUT_MS = 15_000;

/** MCP 프로세스가 감시 서버에 붙는 클라이언트. 감시 중인 파일 경로를 기억하고 스크린샷을 요청한다. 끊기면 2초마다 재접속. */
export class AgentConnection {
  path: string | null = null;
  private socket: WebSocket | null = null;
  private seq = 0;
  private pending = new Map<number, { resolve: (v: string) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  private closed = false;

  constructor(private readonly url: string) { this.connect(); }

  get connected() { return this.socket?.readyState === WebSocket.OPEN; }

  private connect() {
    if (this.closed) return;
    const socket = new WebSocket(this.url);
    this.socket = socket;
    socket.on("open", () => this.send({ kind: "hello", role: "agent" }));
    socket.on("message", (raw) => this.onMessage(JSON.parse(String(raw)) as ServerMessage));
    socket.on("error", () => {/* close가 따라온다 */});
    socket.on("close", () => {
      for (const [id, p] of this.pending) { clearTimeout(p.timer); p.reject(new Error("뷰어 서버 연결이 끊겼습니다.")); this.pending.delete(id); }
      if (!this.closed) setTimeout(() => this.connect(), RECONNECT_MS).unref();
    });
  }

  private onMessage(m: ServerMessage) {
    if (m.kind === "file") this.path = m.path;
    else if (m.kind === "screenshot") this.settle(m.id, (p) => p.resolve(m.dataUrl));
    else if (m.kind === "screenshotFailed") this.settle(m.id, (p) => p.reject(new Error(m.message)));
  }

  private settle(id: number, fn: (p: NonNullable<ReturnType<typeof this.pending.get>>) => void) {
    const p = this.pending.get(id);
    if (!p) return;
    clearTimeout(p.timer);
    this.pending.delete(id);
    fn(p);
  }

  private send(m: ClientMessage) { this.socket?.send(JSON.stringify(m)); }

  screenshot(text: string): Promise<string> {
    if (!this.connected) return Promise.reject(new Error(`뷰어 서버(${this.url})에 연결되어 있지 않습니다. \`npm start -- <모델>\`로 서버와 브라우저를 켜세요.`));
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => this.settle(id, (p) => p.reject(new Error("스크린샷 응답 시간 초과"))), SCREENSHOT_TIMEOUT_MS);
      this.pending.set(id, { resolve, reject, timer });
      this.send({ kind: "screenshotRequest", id, text });
    });
  }

  close() { this.closed = true; this.socket?.close(); }
}
```

`ws`의 `WebSocket`은 이미 의존성에 있다(`import WebSocket from "ws"`). 재접속 타이머에 `.unref()`를 걸어 MCP 프로세스 종료를 막지 않게 한다. 소켓 자체도 stdio가 닫히면 프로세스가 끝나도록 `server/mcp.ts`에서 `process.stdin.on("end", () => process.exit(0))`.

**Step 2: 진입점** `server/mcp.ts`

```ts
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createMcpServer } from "./mcpServer";
import { AgentConnection } from "./agentConnection";

// stdout은 MCP 전송 전용이다. 어떤 로그도 stderr로.
console.log = (...args: unknown[]) => console.error(...args);

const PORT = Number(process.env.PORT ?? 5174);
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const agent = new AgentConnection(`ws://localhost:${PORT}`);

const server = createMcpServer({
  defaultPath: () => agent.path,
  screenshot: (text) => agent.screenshot(text),
  schemaDoc: () => readFileSync(join(root, "docs/schema.md"), "utf8"),
});

process.stdin.on("end", () => process.exit(0));
await server.connect(new StdioServerTransport());
console.error(`3Designer MCP 서버 시작 (뷰어 서버 ws://localhost:${PORT})`);
```

**Step 3: `.mcp.json`** (저장소 루트, 커밋한다)

```json
{
  "mcpServers": {
    "3designer": {
      "command": "npx",
      "args": ["tsx", "server/mcp.ts"]
    }
  }
}
```

`package.json` scripts에 `"mcp": "tsx server/mcp.ts"` 추가.

**Step 4: stdio E2E 테스트** `server/mcp.e2e.test.ts` — 실제 프로세스를 띄워 stdout 오염 없이 커널 검증까지 되는지 본다.

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

let client: Client;
beforeAll(async () => {
  client = new Client({ name: "e2e", version: "0" });
  // PORT=1: 감시 서버가 없는 상황. 재접속 시도는 실패해도 도구는 동작해야 한다.
  await client.connect(new StdioClientTransport({ command: "npx", args: ["tsx", "server/mcp.ts"], env: { ...process.env, PORT: "1" }, stderr: "pipe" }));
});
afterAll(async () => { await client.close(); });

describe("stdio MCP 서버", () => {
  it("도구 8개를 나열한다", async () => { expect((await client.listTools()).tools).toHaveLength(8); });
  it("path로 플랜지를 검증한다 (커널이 stdio를 더럽히지 않는다)", async () => {
    const r = await client.callTool({ name: "validate", arguments: { path: "examples/flange.3d.json" } });
    const body = JSON.parse((r.content as { text: string }[])[0].text);
    expect(body.ok).toBe(true);
    expect(body.measurements.size).toEqual([40, 40, 14]);
  });
  it("경로 없이 호출하면 서버를 켜라고 한다", async () => {
    const r = await client.callTool({ name: "get_model", arguments: {} });
    expect(r.isError).toBe(true);
    expect((r.content as { text: string }[])[0].text).toMatch(/npm start/);
  });
  it("뷰어 서버가 없으면 screenshot은 연결 오류", async () => {
    const r = await client.callTool({ name: "screenshot", arguments: { path: "examples/flange.3d.json" } });
    expect(r.isError).toBe(true);
    expect((r.content as { text: string }[])[0].text).toMatch(/연결되어 있지 않/);
  });
});
```

**Step 5: 전체 테스트·typecheck·빌드** `npm test` (`npm run build`는 서버 코드를 포함하지 않지만 `tsc --noEmit`이 `server/`를 보는지 `tsconfig.json`의 include를 확인한다 — M1~M4에서 `server/**`가 typecheck 범위였다).

**Step 6: 커밋** `feat(mcp): stdio 진입점, 에이전트 연결, .mcp.json, E2E 테스트`

---

## Task 6: 문서와 Claude Code 규칙

**Files:**
- Modify: `CLAUDE.md`, `README.md`, `docs/plans/2026-10-14-3designer-m5-mcp.md` (실행 기록)

**CLAUDE.md** "모델 편집 규칙" 위에 섹션 추가:

```markdown
## MCP 도구 (있으면 파일 직접 편집보다 우선)

`.mcp.json`의 `3designer` 서버가 연결되어 있으면 `mcp__3designer__*` 도구가 보인다. 그때는 파일을 손으로 편집하지 말고 도구를 쓴다. 검증 결과가 바로 돌아오므로 errors.json을 기다릴 필요가 없다.

1. `get_model` — 편집 전에 항상 호출한다 (사용자가 UI에서 바꿨을 수 있다).
2. 치수 변경은 `set_parameter`, 피처 추가/수정/삭제는 `add_feature` / `update_feature` / `delete_feature`. 큰 개편은 `validate`에 `model`을 넣어 먼저 시험한 뒤 `write_model`.
3. 응답의 `ok`가 false면 `schema`/`features`를 읽고 고친다. `warnings`(바닥이 Z<0 등)는 사용자에게 알리거나 고친다. `measurements`로 크기·부피를 사용자에게 보고한다.
4. 형상이 의도대로인지 확실하지 않으면 `screenshot`으로 확인한다 (브라우저가 열려 있어야 한다).
5. 도구가 없으면(서버 미승인 등) 아래 파일 편집 규칙대로 한다.
```

**README.md**: "사용 흐름" 2번 뒤에 "Claude Code MCP 연동" 소절 — 프로젝트 폴더에서 Claude Code를 열면 `.mcp.json`을 감지해 승인을 묻는다; 다른 폴더에서 쓰려면 `claude mcp add 3designer -- npx tsx /절대경로/3Designer/server/mcp.ts`; 도구 목록 한 줄씩; 스크린샷은 브라우저 필요. 로드맵에서 M5를 완료로 옮기고 M6만 남긴다. "구조"의 `server/` 설명에 "MCP 서버" 추가.

**실행 기록**: 이 계획 끝에 "## 실행 기록 (2026-10-14)" 섹션을 두고 계획과 달라진 점을 적는다.

**커밋** `docs: MCP 도구 사용 규칙과 README (M5)`

---

## 완료 확인 (컨트롤러가 직접)

1. `npm start -- examples/flange.3d.json` + Chrome에서 http://localhost:5173 열기. 서버 로그에 "뷰어 연결".
2. 별도 터미널에서 MCP 클라이언트(테스트 스크립트 또는 `npx tsx`)로 `set_parameter D=50` → 브라우저가 즉시 갱신되고 응답 `measurements.size[0] === 50`.
3. `screenshot` → PNG가 돌아오고 안에 플랜지가 보인다 (파일로 저장해 Read로 확인).
4. `update_feature edge radius 50` → `features`에 커널 오류, 화면 배너에도 같은 오류.
5. `git checkout examples/flange.3d.json`으로 되돌리고 서버 종료.

---

## 실행 기록 (2026-10-14)

Task 1~6 모두 `m5-mcp` 브랜치에서 완료. 검증·중계·에이전트 연결·MCP 도구·stdio E2E 테스트 추가 (`server/validate.test.ts`, `server/relay.test.ts`, `server/agentConnection.test.ts`, `server/mcpServer.test.ts`, `server/mcp.e2e.test.ts`, `src/state/screenshot.test.ts`). `npx vitest run` 17 파일 / 223 테스트 통과, `npm run typecheck` 깨끗함.

계획과 달라진 점:

- **Task 1 (검증)**: 컷이 바디를 모두 제거하거나 겹치지 않는 교집합이면 커널이 오류 없이 빈 Shape3D를 돌려주고, 그 `boundingBox`는 "Bnd_Box is void"를 던진다. `measureVolume`을 먼저 재서 0이면 `measurements: null` + 경고("형상이 비어 있습니다 …")로 처리한다. 측정이 끝난 shape는 `shape.delete()`로 해제한다(장기 실행 MCP 프로세스의 WASM 힙 누수 방지). 치명적 커널 오류(런타임 손상)는 `features`로 감싸지 않고 던져 호출자가 재시작을 결정한다. 커널 초기화는 `src/kernel/node.ts`(`initKernelForNode`)로 모았다.
- **Task 2 (중계)**: 스크린샷 답은 그 요청을 받은 뷰어만 할 수 있다(`isResponder`로 응답자 검증; 모르는 id·다른 클라이언트의 답은 무시). 뷰어·에이전트 모두 연결이 열릴 때 `hello`를 한 번 보낸다. 비객체 JSON(null, 숫자)은 무시한다.
- **Task 3 (뷰어 캡처)**: 캡처 조건을 "kernelStatus가 busy 아님"에서 "평가가 끝난 모델(`meshPart`)이 요청 텍스트와 같은 모델"로 교정했다. `loadJson`/`applyEdit`가 `set({part})` 뒤에야 busy로 바꾸므로 그 사이 통지에서 옛 메시를 찍는 버그가 있었다. 비교는 `compactPart` 대신 양쪽 Zod 출력의 키를 재귀 정렬한 canonical JSON으로 한다(`parameters`의 키 순서 차이 무시). 요청한 모델의 평가가 커널 예외(featureId `"*"`)로 끝났거나 워커가 죽었으면(kernelStatus `error`) 기다리지 않고 `screenshotFailed`. 캡처 전에 rAF 한 프레임을 기다리되 숨은 탭에서는 rAF가 멈추므로 100ms 타이머로도 깨운다. 타임아웃 문구는 `get_model`로 다시 읽고 재시도하라고 안내한다.
- **Task 4 (MCP 도구)**: `compactPart`는 쓰기 시점에만 적용한다(편집 함수 결과는 검증 전 느슨한 객체일 수 있음). `update_feature`는 `type` 변경을 거부하고(삭제 후 추가 안내), `patch.id`로 id 변경은 허용하며 응답의 `id`가 최종 id다. `set_parameter`는 없는 변수를 새로 만들 수 있고 이름은 `^[A-Za-z_][A-Za-z0-9_]*$`. `add_feature`의 `index`가 범위를 넘으면 끝에 붙인다. 파일 쓰기는 `server/atomicWrite.ts`의 `writeFileAtomic`(같은 디렉터리 임시 파일 + rename)로 하고 뷰어 저장(`projectFile.ts`)도 같은 함수를 쓴다. chokidar가 rename 뒤에도 감시를 유지하는지 확인했다. 도구마다 annotations를 달았다(`get_model`/`validate`/`screenshot` readOnly, `set_parameter`/`add_feature`/`update_feature` idempotent, `write_model`/`delete_feature` destructive). 치명적 커널 오류는 `onFatalKernelError` 훅을 부른 뒤 재시작 안내 응답을 돌려주고, 진입점은 응답이 먼저 나가도록 다음 틱에 연결과 전송을 닫고 `exitCode = 1`로 자연 종료한다(세션 중 자동 재시작은 없으므로 사용자가 Claude Code에서 `/mcp`로 다시 연결한다).
- **Task 5 (진입점·연결)**: `AgentConnection`은 재접속으로 교체된 옛 소켓의 close를 무시하고, `send`는 connected일 때만 보낸다. Claude Code가 stdin을 닫으면 `agent.close()` 후 `exit(0)`(재접속 타이머는 unref지만 열린 소켓은 종료를 막으므로). `console.log`/`info`/`debug`는 stderr로 돌려 stdio 전송을 보호하고, E2E 테스트는 `client.onerror`로 stdout 오염을 실제로 검출한다(오염 주입 시 실패함을 확인). `.mcp.json`은 `npx tsx` 대신 `node --import tsx`로 띄워 프로세스가 하나만 뜨고 네트워크가 필요 없다.
- 사전 검증 외 발견: `npx tsx -e`는 top-level await가 안 되므로 수동 확인 스크립트는 `.mts` 파일로 썼다. add_feature 예시의 chamfer `edges: "top"`은 이미 필렛된 윗면이라 커널이 실패하므로 테스트를 `distance: 100, edges: "bottom"`(확실한 커널 오류)으로 바꿨다.
- `docs/schema.md`는 스키마 변경이 없어 손대지 않았다.

### 완료 확인 (Chrome, 컨트롤러 직접)

`npm start`(PORT 5180) + Chrome 뷰어 + MCP 클라이언트 스크립트로 확인: `get_model`이 감시 파일 경로를 돌려줌 → `set_parameter D=50` 직후 뷰어 갱신(헤더 50×50×14) → `screenshot`이 D=50 플랜지 PNG를 돌려줌 → `update_feature edge radius 50`이 응답·errors.json·화면 배너에 같은 커널 오류 → 복구 후 errors.json 비움 → `set_parameter D=70`과 `screenshot`을 같은 세션에서 연달아 호출해도 새 모델(D=70)이 찍힘(최신 모델 반영 대기 동작) → UI에서 D를 40으로 고치면 파일 저장 후 `get_model`이 40을 읽음. 통합 검토 에이전트는 브라우저 없이 같은 도구 흐름(add/delete/validate/write_model 포함)과 "뷰어 없음" 실패 경로를 확인함.

### 알려진 한계 (M5 이후)

- 뷰어 탭이 한 번도 그려지지 않았으면(백그라운드 탭으로 열린 직후) R3F 캔버스가 아직 마운트되지 않아 `screenshot`이 "뷰포트가 아직 준비되지 않았습니다"로 실패한다. 탭을 한 번 보이게 하면 이후에는 백그라운드여도 된다.
- 스크린샷은 캔버스 해상도 그대로(약 1400×2300, PNG 300KB 안팎)라 에이전트 컨텍스트를 많이 쓴다. 축소 캡처(예: 최대 800px)는 후속 과제.
- 복잡한 모델의 브라우저 평가가 8초를 넘으면 `screenshot`이 타임아웃하고 `get_model` 후 재시도를 안내한다.
- UI 편집(300ms 디바운스 저장)과 MCP 쓰기가 교차하면 뷰어 저장이 이긴다(last-write-wins). MCP 응답은 이미 `written: true`를 돌려준 뒤라 결과가 뒤집힐 수 있다. "편집 전 `get_model`" 규칙이 완화책.
- 감시 서버는 떠 있는데 파일을 못 읽는 경우(`fileError`) `AgentConnection`이 경로를 비워 두므로 도구가 "서버를 먼저 켜세요"로 원인을 오도한다. `fileError` 메시지를 기억해 돌려주는 개선은 후속.
- 심볼릭 링크 아래 경로(macOS `/tmp` → `/private/tmp`)에서는 rename 쓰기가 chokidar 이벤트를 내지 않는 것이 관찰됐다(원인 추정: 링크 경로 감시). `server/index.ts`에서 `realpathSync`로 감시하면 해결될 가능성이 높으나 미검증.
- `.mcp.json`의 `node --import tsx server/mcp.ts`는 cwd가 저장소 루트일 때만 동작한다. 다른 폴더에서는 README대로 `npx tsx /절대경로/...`로 등록한다.
- 치명적 커널 오류 시 자동 재시작 없음 — `/mcp`로 재연결.
