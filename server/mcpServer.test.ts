import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync, rmSync, copyFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createMcpServer, type McpDeps } from "./mcpServer";
import { validatePart } from "./validate";

// 치명적 커널 오류 테스트에서 validatePart만 한 번 바꿔치기할 수 있도록 실제 구현을 vi.fn으로 감싼다.
// 나머지 테스트는 실제 구현(커널 포함)을 그대로 탄다.
vi.mock("./validate", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./validate")>();
  return { ...actual, validatePart: vi.fn(actual.validatePart) };
});

const FLANGE = fileURLToPath(new URL("../examples/flange.3d.json", import.meta.url));
const BOX_LID = fileURLToPath(new URL("../examples/box-lid.3d.json", import.meta.url));
let dir: string;
let file: string;
let client: Client;
let deps: McpDeps;

function contentOf(result: unknown) {
  return (result as { content: { type: string; text?: string; data?: string; mimeType?: string }[] }).content;
}
function textOf(result: unknown): string {
  return contentOf(result).find((c) => c.type === "text")?.text ?? "";
}
function jsonOf(result: unknown) {
  return JSON.parse(textOf(result));
}
function fileJson() {
  return JSON.parse(readFileSync(file, "utf8"));
}
async function call(name: string, args: Record<string, unknown> = {}) {
  return client.callTool({ name, arguments: args });
}
/** 리소스 contents는 text | blob 유니온이므로 text만 뽑는다 */
async function resourceText(uri: string): Promise<string | undefined> {
  const [first] = (await client.readResource({ uri })).contents;
  return "text" in first ? first.text : undefined;
}

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "3designer-mcp-"));
  file = join(dir, "flange.3d.json");
  copyFileSync(FLANGE, file);
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
afterEach(async () => {
  await client.close();
  rmSync(dir, { recursive: true, force: true });
  // 치명적 오류 테스트가 남긴 일회성 목이 다음 테스트로 새지 않게 원 구현으로 되돌린다
  vi.mocked(validatePart).mockReset();
});

describe("도구 목록", () => {
  it("도구 8개와 리소스 1개", async () => {
    const names = (await client.listTools()).tools.map((t) => t.name).sort();
    expect(names).toEqual([
      "add_feature",
      "delete_feature",
      "get_model",
      "screenshot",
      "set_parameter",
      "update_feature",
      "validate",
      "write_model",
    ]);
    expect((await client.listResources()).resources[0].uri).toBe("doc://3designer/schema");
  });

  it("도구 annotations: 읽기 전용·파괴적 구분", async () => {
    const tools = Object.fromEntries((await client.listTools()).tools.map((t) => [t.name, t.annotations]));
    for (const name of ["get_model", "validate", "screenshot"]) expect(tools[name], name).toMatchObject({ readOnlyHint: true });
    for (const name of ["write_model", "delete_feature"]) expect(tools[name], name).toMatchObject({ destructiveHint: true });
    for (const name of ["set_parameter", "add_feature", "update_feature"]) {
      expect(tools[name], name).toMatchObject({ destructiveHint: false, idempotentHint: true });
    }
    expect(await resourceText("doc://3designer/schema")).toBe("# 스키마");
  });

  it("리소스는 호출 시점의 deps.schemaDoc을 읽는다", async () => {
    deps.schemaDoc = () => "# 바뀐 스키마";
    expect(await resourceText("doc://3designer/schema")).toBe("# 바뀐 스키마");
  });
});

describe("get_model", () => {
  it("기본 경로의 모델을 돌려준다", async () => {
    const r = jsonOf(await call("get_model"));
    expect(r.path).toBe(file);
    expect(r.model.parameters.D).toBe(40);
    expect(r.model.features).toHaveLength(5);
  });

  it("path 인자가 우선한다", async () => {
    const other = join(dir, "box-lid.3d.json");
    copyFileSync(BOX_LID, other);
    const r = jsonOf(await call("get_model", { path: other }));
    expect(r.path).toBe(other);
    expect(r.model.parameters.W).toBe(60);
    expect(r.model.features.map((f: { id: string }) => f.id)).toEqual(["plate", "lipOuter", "lipInner", "round"]);
  });

  it("돌려주는 모델은 compact 형식이다 (기본값 없음)", async () => {
    const r = jsonOf(await call("get_model"));
    expect(r.model.features[0]).not.toHaveProperty("op");
    expect(r.model.features[0]).not.toHaveProperty("suppressed");
    expect(r.model.features[2].op).toBe("cut");
  });

  it("기본 경로가 없으면 오류", async () => {
    deps.defaultPath = () => null;
    const r = await call("get_model");
    expect(r.isError).toBe(true);
    expect(textOf(r)).toMatch(/npm start/);
  });

  it("없는 파일이면 오류", async () => {
    const missing = join(dir, "nope.3d.json");
    const r = await call("get_model", { path: missing });
    expect(r.isError).toBe(true);
    expect(textOf(r)).toContain(missing);
  });

  it("파일에 스키마 오류가 있어도 원문과 오류를 돌려준다", async () => {
    writeFileSync(file, '{"version":1,"units":"mm","features":[{"id":"a","type":"box"}]}');
    const r = jsonOf(await call("get_model"));
    expect(r.path).toBe(file);
    expect(r.schema[0].path).toBe("features.0.size");
    expect(r.raw).toContain('"type":"box"');
    expect(r.model).toBeUndefined();
  });
});

describe("validate", () => {
  it("파일을 검증한다", async () => {
    const r = jsonOf(await call("validate"));
    expect(r.ok).toBe(true);
    expect(r.measurements.size).toEqual([40, 40, 14]);
  });

  it("model 인자가 있으면 파일을 건드리지 않고 그것을 검증한다", async () => {
    const model = fileJson();
    model.features[4].radius = 50;
    const before = readFileSync(file, "utf8");
    const r = jsonOf(await call("validate", { model }));
    expect(r.ok).toBe(false);
    expect(r.features[0].featureId).toBe("edge");
    expect(readFileSync(file, "utf8")).toBe(before);
  });

  it("model 인자만 있고 경로가 없어도 동작한다", async () => {
    deps.defaultPath = () => null;
    const r = await call("validate", { model: fileJson() });
    expect(r.isError).toBeFalsy();
    expect(jsonOf(r).ok).toBe(true);
  });

  it("스키마 오류인 model은 isError 없이 schema로 알린다", async () => {
    const r = await call("validate", { model: { version: 1, units: "mm", features: [{ id: "a", type: "box" }] } });
    expect(r.isError).toBeFalsy();
    expect(jsonOf(r).ok).toBe(false);
    expect(jsonOf(r).schema[0].path).toBe("features.0.size");
  });

  it("파일이 깨져 있어도 isError 없이 schema로 알린다", async () => {
    writeFileSync(file, "{ nope");
    const r = await call("validate");
    expect(r.isError).toBeFalsy();
    expect(jsonOf(r).schema[0].message).toMatch(/JSON 문법 오류/);
  });
});

describe("write_model", () => {
  it("스키마 오류면 쓰지 않고 isError", async () => {
    const before = readFileSync(file, "utf8");
    const r = await call("write_model", {
      model: { version: 1, units: "mm", features: [{ id: "a", type: "box" }] },
    });
    expect(r.isError).toBe(true);
    expect(jsonOf(r).written).toBe(false);
    expect(jsonOf(r).schema[0].path).toBe("features.0.size");
    expect(readFileSync(file, "utf8")).toBe(before);
  });

  it("통과하면 compact 형식으로 쓰고 결과를 돌려준다", async () => {
    const model = fileJson();
    model.parameters.D = 50;
    model.features[0].op = "add"; // 기본값 → 저장 시 빠져야 한다
    const r = jsonOf(await call("write_model", { model }));
    expect(r.written).toBe(true);
    expect(r.path).toBe(file);
    expect(r.ok).toBe(true);
    expect(r.measurements.size[0]).toBe(50);
    const written = readFileSync(file, "utf8");
    expect(written.endsWith("\n")).toBe(true);
    expect(written).not.toContain('"op": "add"');
    expect(written).toContain('  "version": 1'); // 2칸 들여쓰기
    expect(JSON.parse(written).parameters.D).toBe(50);
  });

  it("커널 오류가 있어도 쓰되 isError 없이 features로 알린다", async () => {
    const model = fileJson();
    model.features[4].radius = 50;
    const r = await call("write_model", { model });
    expect(r.isError).toBeFalsy();
    const body = jsonOf(r);
    expect(body.written).toBe(true);
    expect(body.ok).toBe(false);
    expect(body.features[0].featureId).toBe("edge");
    expect(fileJson().features[4].radius).toBe(50);
  });

  it("path 인자로 다른 파일에 쓴다", async () => {
    const other = join(dir, "new.3d.json");
    const r = jsonOf(await call("write_model", { model: fileJson(), path: other }));
    expect(r.written).toBe(true);
    expect(r.path).toBe(other);
    expect(JSON.parse(readFileSync(other, "utf8")).parameters.D).toBe(40);
  });

  it("경로가 없으면 오류", async () => {
    deps.defaultPath = () => null;
    const r = await call("write_model", { model: fileJson() });
    expect(r.isError).toBe(true);
    expect(textOf(r)).toMatch(/npm start/);
  });
});

describe("편집 도구", () => {
  it("set_parameter", async () => {
    const r = jsonOf(await call("set_parameter", { name: "D", value: 60 }));
    expect(r.ok).toBe(true);
    expect(r.written).toBe(true);
    expect(r.measurements.size[0]).toBe(60);
    expect(fileJson().parameters.D).toBe(60);
  });

  it("set_parameter는 새 변수도 만든다", async () => {
    const r = jsonOf(await call("set_parameter", { name: "newVar", value: 3 }));
    expect(r.ok).toBe(true);
    expect(fileJson().parameters.newVar).toBe(3);
  });

  it("set_parameter는 숫자만 받는다", async () => {
    const r = await call("set_parameter", { name: "D", value: "D*2" });
    expect(r.isError).toBe(true);
    expect(fileJson().parameters.D).toBe(40);
  });

  it("set_parameter는 변수 이름 형식을 검사한다", async () => {
    const before = readFileSync(file, "utf8");
    for (const name of ["1abc", "a-b", "a b", "", "볼트"]) {
      const r = await call("set_parameter", { name, value: 1 });
      expect(r.isError, name).toBe(true);
      expect(textOf(r), name).toMatch(/변수 이름은/);
    }
    expect(readFileSync(file, "utf8")).toBe(before);
    expect(jsonOf(await call("set_parameter", { name: "_w2", value: 1 })).ok).toBe(true);
    expect(fileJson().parameters._w2).toBe(1);
  });

  it("add_feature는 끝에 붙이고 index가 있으면 그 자리에", async () => {
    const r = jsonOf(
      await call("add_feature", {
        feature: { id: "top", type: "chamfer", name: "모따기", distance: 100, edges: "bottom" },
      }),
    );
    // 부품보다 큰 모따기 → 확실한 커널 오류. 스키마는 통과하므로 쓰이고 features로 알린다
    expect(r.written).toBe(true);
    expect(r.ok).toBe(false);
    expect(r.features[0]).toMatchObject({ featureId: "top", stage: "kernel" });
    expect(fileJson().features.at(-1).id).toBe("top");
    await call("add_feature", { feature: { id: "base", type: "box", size: [60, 60, 2] }, index: 0 });
    expect(fileJson().features[0].id).toBe("base");
    expect(fileJson().features).toHaveLength(7);
  });

  it("add_feature index가 범위를 넘으면 끝에 붙는다", async () => {
    const r = jsonOf(await call("add_feature", { feature: { id: "far", type: "box", size: [1, 1, 1] }, index: 99 }));
    expect(r.written).toBe(true);
    expect(fileJson().features.at(-1).id).toBe("far");
    expect(fileJson().features).toHaveLength(6);
  });

  it("add_feature 중복 id는 스키마 오류로 거부하고 쓰지 않는다", async () => {
    const before = readFileSync(file, "utf8");
    const r = await call("add_feature", { feature: { id: "body", type: "box", size: [1, 1, 1] } });
    expect(r.isError).toBe(true);
    expect(textOf(r)).toMatch(/id 중복/);
    expect(readFileSync(file, "utf8")).toBe(before);
  });

  it("add_feature 잘못된 피처는 스키마 오류 경로를 알려준다", async () => {
    const before = readFileSync(file, "utf8");
    const r = await call("add_feature", { feature: { id: "x", type: "box" } });
    expect(r.isError).toBe(true);
    expect(jsonOf(r).written).toBe(false);
    expect(jsonOf(r).schema[0].path).toBe("features.5.size");
    expect(readFileSync(file, "utf8")).toBe(before);
  });

  it("add_feature는 type이 없거나 pattern이 문자열이어도 터지지 않고 스키마 오류로 거부한다", async () => {
    const noType = await call("add_feature", { feature: { id: "x" } });
    expect(noType.isError).toBe(true);
    expect(jsonOf(noType).schema[0].path).toMatch(/^features\.5/);
    const badPattern = await call("add_feature", {
      feature: { id: "y", type: "box", size: [1, 1, 1], pattern: "linear" },
    });
    expect(badPattern.isError).toBe(true);
    expect(jsonOf(badPattern).schema[0].path).toMatch(/^features\.5\.pattern/);
    expect(fileJson().features).toHaveLength(5);
  });

  it("update_feature는 얕게 병합하고 없는 id는 오류", async () => {
    const r = jsonOf(
      await call("update_feature", {
        id: "bolts",
        patch: { positions: { pattern: "circular", count: 6, diameter: "boltPCD" } },
      }),
    );
    expect(r.ok).toBe(true);
    expect(fileJson().features[3].positions.count).toBe(6);
    expect(fileJson().features[3].diameter).toBe(3.4); // 다른 필드는 유지
    const bad = await call("update_feature", { id: "nope", patch: {} });
    expect(bad.isError).toBe(true);
    expect(textOf(bad)).toMatch(/피처가 없습니다: nope/);
  });

  it("update_feature로 suppressed를 켤 수 있다", async () => {
    const r = jsonOf(await call("update_feature", { id: "edge", patch: { suppressed: true } }));
    expect(r.ok).toBe(true);
    expect(fileJson().features[4].suppressed).toBe(true);
    // 다시 끄면 기본값이라 저장 파일에서 빠진다
    await call("update_feature", { id: "edge", patch: { suppressed: false } });
    expect(fileJson().features[4]).not.toHaveProperty("suppressed");
  });

  it("update_feature로 type을 바꾸려 하면 거부하고 파일은 그대로", async () => {
    const before = readFileSync(file, "utf8");
    const r = await call("update_feature", { id: "bolts", patch: { type: "box" } });
    expect(r.isError).toBe(true);
    expect(textOf(r)).toMatch(/type/);
    expect(readFileSync(file, "utf8")).toBe(before);
  });

  it("update_feature로 id를 바꿀 수 있고 응답의 id가 최종 id다", async () => {
    const r = jsonOf(await call("update_feature", { id: "edge", patch: { id: "topFillet", name: "윗면 R" } }));
    expect(r.ok).toBe(true);
    expect(r.id).toBe("topFillet");
    expect(fileJson().features[4]).toMatchObject({ id: "topFillet", name: "윗면 R", radius: 1 });
    expect(fileJson().features).toHaveLength(5);
    // id를 안 바꾸면 응답 id는 원래 id
    expect(jsonOf(await call("update_feature", { id: "bolts", patch: { diameter: 4 } })).id).toBe("bolts");
    // 중복 id로는 바꿀 수 없다
    const before = readFileSync(file, "utf8");
    const dup = await call("update_feature", { id: "topFillet", patch: { id: "body" } });
    expect(dup.isError).toBe(true);
    expect(textOf(dup)).toMatch(/id 중복/);
    expect(readFileSync(file, "utf8")).toBe(before);
  });

  it("update_feature로 같은 type을 다시 주는 것은 허용", async () => {
    const r = jsonOf(await call("update_feature", { id: "bolts", patch: { type: "hole", diameter: 4 } }));
    expect(r.ok).toBe(true);
    expect(fileJson().features[3].diameter).toBe(4);
  });

  it("update_feature 잘못된 값은 스키마 오류로 거부하고 쓰지 않는다", async () => {
    const before = readFileSync(file, "utf8");
    const r = await call("update_feature", { id: "edge", patch: { edges: "sideways" } });
    expect(r.isError).toBe(true);
    expect(jsonOf(r).schema[0].path).toBe("features.4.edges");
    expect(readFileSync(file, "utf8")).toBe(before);
  });

  it("delete_feature", async () => {
    const r = jsonOf(await call("delete_feature", { id: "edge" }));
    expect(r.ok).toBe(true);
    expect(fileJson().features).toHaveLength(4);
    const bad = await call("delete_feature", { id: "nope" });
    expect(bad.isError).toBe(true);
    expect(textOf(bad)).toMatch(/피처가 없습니다: nope/);
    expect(fileJson().features).toHaveLength(4);
  });

  it("파일에 스키마 오류가 있으면 편집을 거부한다", async () => {
    writeFileSync(file, "{ nope");
    const r = await call("set_parameter", { name: "D", value: 1 });
    expect(r.isError).toBe(true);
    expect(textOf(r)).toMatch(/write_model/);
    expect(jsonOf(r).written).toBe(false);
    expect(readFileSync(file, "utf8")).toBe("{ nope");
  });

  it("모든 편집 도구가 깨진 파일을 거부한다", async () => {
    writeFileSync(file, '{"version":1,"units":"mm","features":[{"id":"a","type":"box"}]}');
    const calls: [string, Record<string, unknown>][] = [
      ["add_feature", { feature: { id: "b", type: "box", size: [1, 1, 1] } }],
      ["update_feature", { id: "a", patch: { size: [1, 1, 1] } }],
      ["delete_feature", { id: "a" }],
    ];
    for (const [name, args] of calls) {
      const r = await call(name, args);
      expect(r.isError, name).toBe(true);
      expect(textOf(r), name).toMatch(/write_model/);
    }
    expect(fileJson().features[0]).not.toHaveProperty("size");
  });

  it("편집 도구도 path 인자를 받는다", async () => {
    const other = join(dir, "box-lid.3d.json");
    copyFileSync(BOX_LID, other);
    const r = jsonOf(await call("set_parameter", { name: "W", value: 80, path: other }));
    expect(r.ok).toBe(true);
    expect(JSON.parse(readFileSync(other, "utf8")).parameters.W).toBe(80);
    expect(fileJson().parameters.D).toBe(40); // 기본 파일은 그대로
  });

  it("편집 도구에서 수식·커널 오류는 파일에 쓰고 features로 알린다", async () => {
    const r = await call("update_feature", { id: "edge", patch: { radius: 50 } });
    expect(r.isError).toBeFalsy();
    expect(jsonOf(r).written).toBe(true);
    expect(jsonOf(r).ok).toBe(false);
    expect(jsonOf(r).features[0].featureId).toBe("edge");
    expect(fileJson().features[4].radius).toBe(50);
  });
});

describe("screenshot", () => {
  it("이미지와 측정값을 돌려주고, 파일 텍스트를 뷰어 대기용으로 넘긴다", async () => {
    let received: string | undefined;
    deps.screenshot = async (text) => {
      received = text;
      return "data:image/png;base64,iVBORw0KGgo=";
    };
    const r = await call("screenshot");
    expect(r.isError).toBeFalsy();
    const img = contentOf(r).find((c) => c.type === "image");
    expect(img).toMatchObject({ mimeType: "image/png", data: "iVBORw0KGgo=" });
    expect(jsonOf(r).measurements.size).toEqual([40, 40, 14]);
    expect(received).toBe(readFileSync(file, "utf8"));
  });

  it("스키마 오류가 있으면 요청하지 않는다", async () => {
    writeFileSync(file, "{ nope");
    let called = false;
    deps.screenshot = async () => {
      called = true;
      return "";
    };
    const r = await call("screenshot");
    expect(r.isError).toBe(true);
    expect(jsonOf(r).schema[0].message).toMatch(/JSON 문법 오류/);
    expect(called).toBe(false);
  });

  it("커널 오류가 있어도 (뷰어는 나머지를 그리므로) 스크린샷을 찍고 features로 알린다", async () => {
    const model = fileJson();
    model.features[4].radius = 50;
    writeFileSync(file, JSON.stringify(model));
    const r = await call("screenshot");
    expect(r.isError).toBeFalsy();
    expect(contentOf(r).find((c) => c.type === "image")).toBeDefined();
    expect(jsonOf(r).features[0].featureId).toBe("edge");
  });

  it("뷰어 실패를 isError로 전달한다", async () => {
    deps.screenshot = async () => {
      throw new Error("브라우저(뷰어)가 연결되어 있지 않습니다.");
    };
    const r = await call("screenshot");
    expect(r.isError).toBe(true);
    expect(textOf(r)).toMatch(/브라우저/);
  });

  it("경로가 없으면 오류", async () => {
    deps.defaultPath = () => null;
    const r = await call("screenshot");
    expect(r.isError).toBe(true);
    expect(textOf(r)).toMatch(/npm start/);
  });
});

describe("치명적 커널 오류", () => {
  it("onFatalKernelError를 부르고 재시작 안내를 돌려준다", async () => {
    const onFatal = vi.fn();
    deps.onFatalKernelError = onFatal;
    vi.mocked(validatePart).mockRejectedValueOnce(new Error("Aborted(native code called abort())"));
    const r = await call("validate");
    expect(r.isError).toBe(true);
    expect(textOf(r)).toMatch(/재시작/);
    expect(textOf(r)).toMatch(/Aborted/);
    expect(onFatal).toHaveBeenCalledTimes(1);
    expect(onFatal.mock.calls[0][0]).toBeInstanceOf(Error);
    // 목은 한 번만 적용되므로 다음 호출은 실제 구현으로 정상 동작한다
    expect(jsonOf(await call("validate")).ok).toBe(true);
  });

  it("편집 도구에서도 치명적 오류를 잡고 파일은 쓰지 않는다", async () => {
    const onFatal = vi.fn();
    deps.onFatalKernelError = onFatal;
    const before = readFileSync(file, "utf8");
    vi.mocked(validatePart).mockRejectedValueOnce(new Error("Aborted(native code called abort())"));
    const r = await call("set_parameter", { name: "D", value: 99 });
    expect(r.isError).toBe(true);
    expect(textOf(r)).toMatch(/재시작/);
    expect(onFatal).toHaveBeenCalledTimes(1);
    expect(readFileSync(file, "utf8")).toBe(before);
  });

  it("비치명 예외는 onFatalKernelError를 부르지 않는다", async () => {
    const onFatal = vi.fn();
    deps.onFatalKernelError = onFatal;
    vi.mocked(validatePart).mockRejectedValueOnce(new Error("그냥 실패"));
    const r = await call("validate");
    expect(r.isError).toBe(true);
    expect(textOf(r)).toBe("그냥 실패");
    expect(onFatal).not.toHaveBeenCalled();
  });

  it("onFatalKernelError가 없어도 재시작 안내를 돌려준다", async () => {
    vi.mocked(validatePart).mockRejectedValueOnce(new Error("Aborted(native code called abort())"));
    const r = await call("validate");
    expect(r.isError).toBe(true);
    expect(textOf(r)).toMatch(/재시작/);
  });
});
