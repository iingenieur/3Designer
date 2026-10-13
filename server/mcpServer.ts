import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { validatePart, parsePart } from "./validate";
import { writeFileAtomic } from "./atomicWrite";
import * as edit from "../src/model/edit";
import type { Part, Feature } from "../src/model/schema";
import { isFatalKernelError, errorMessage } from "../src/kernel/errors";

export interface McpDeps {
  /** 감시 서버가 알려준 현재 모델 파일. 모르면 null. */
  defaultPath: () => string | null;
  /** 뷰어 스크린샷을 PNG data URL로. text는 뷰어가 먼저 반영해야 할 파일 내용. 실패하면 던진다. */
  screenshot: (text: string) => Promise<string>;
  /** docs/schema.md 내용 */
  schemaDoc: () => string;
  /**
   * 커널 런타임이 손상됐을 때(이후 모든 검증이 실패한다). 진입점이 프로세스를 재시작하는 데 쓴다.
   * 훅은 응답을 반환하기 전에 불린다. 동기로 process.exit 하지 말고 타이머/setImmediate로 미뤄
   * 재시작 안내 응답이 먼저 나가게 할 것. 훅이 던져도 안내문은 그대로 돌아간다.
   */
  onFatalKernelError?: (error: unknown) => void;
}

const pathArg = z
  .string()
  .optional()
  .describe(
    "모델 파일 경로(*.3d.json). 생략하면 npm start로 띄운 서버가 감시 중인 파일. " +
      "절대 경로 권장(상대 경로는 MCP 프로세스의 cwd 기준).",
  );
const modelArg = z
  .record(z.string(), z.unknown())
  .describe("모델 전체 객체. 형식은 리소스 doc://3designer/schema (docs/schema.md).");
const featureArg = z
  .record(z.string(), z.unknown())
  .describe('피처 객체. 예: {"id":"lid","type":"box","name":"뚜껑","size":[40,40,2]}');

const NO_PATH = "path를 지정하거나 `npm start -- <모델>.3d.json`으로 서버를 먼저 켜세요.";
const BROKEN_FILE = "현재 파일에 스키마 오류가 있어 편집할 수 없습니다. validate로 확인하고 write_model로 고치세요.";
const TYPE_CHANGE = "피처 type은 바꿀 수 없습니다. delete_feature 후 add_feature를 쓰세요.";
const nameArg = z
  .string()
  .regex(/^[A-Za-z_][A-Za-z0-9_]*$/, "변수 이름은 영문자/밑줄로 시작하고 영문자·숫자·밑줄만 쓴다");

/** 읽기만 하는 도구 */
const READ_ONLY = { readOnlyHint: true } as const;
/** 파일을 바꾸지만 같은 인자로 다시 불러도 같은 결과인 편집 도구 */
const SAFE_EDIT = { readOnlyHint: false, destructiveHint: false, idempotentHint: true } as const;
/** 되돌릴 수 없는 변경(피처 삭제, 모델 전체 교체) */
const DESTRUCTIVE = { readOnlyHint: false, destructiveHint: true } as const;

function text(value: unknown): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(value, null, 1) }] };
}
function fail(value: unknown): CallToolResult {
  return { ...text(value), isError: true };
}

/**
 * Claude Code가 모델 파일을 편집하는 데 쓰는 MCP 서버를 만든다. 진입점(stdio 연결, 감시 서버와의 통신)은
 * 따로 두고 여기서는 deps로 주입받는다. deps의 메서드는 호출 시점마다 읽으므로 나중에 바꿔 끼울 수 있다.
 */
export function createMcpServer(deps: McpDeps): McpServer {
  const server = new McpServer({ name: "3designer", version: "0.1.0" });

  /**
   * 도구 핸들러 공통 래퍼. 치명적 커널 오류(WASM 런타임 손상)는 같은 프로세스의 이후 호출을 전부 깨뜨리므로
   * 훅을 부르고 재시작 안내를 돌려준다. 나머지 예외는 SDK가 isError 텍스트로 바꾼다.
   */
  async function guard(run: () => Promise<CallToolResult>): Promise<CallToolResult> {
    try {
      return await run();
    } catch (e) {
      if (isFatalKernelError(e)) {
        try {
          deps.onFatalKernelError?.(e);
        } catch {
          // 훅 오류가 재시작 안내문을 삼키지 않게 한다
        }
        return fail({ message: `커널 런타임이 손상되었습니다. MCP 서버를 재시작하세요: ${errorMessage(e)}` });
      }
      throw e;
    }
  }

  function resolvePath(path: string | undefined): string {
    const p = path ?? deps.defaultPath();
    if (!p) throw new Error(NO_PATH);
    return resolve(p);
  }

  function readText(path: string): string {
    try {
      return readFileSync(path, "utf8");
    } catch (e) {
      throw new Error(`파일을 읽을 수 없습니다: ${path} (${errorMessage(e)})`);
    }
  }

  /** 사람이 쓴 파일처럼 기본값을 빼고 2칸 들여쓰기 + 끝 개행으로, 뷰어 저장과 교차해도 안전하게 원자적으로 쓴다. */
  function write(path: string, part: Part): void {
    writeFileAtomic(path, JSON.stringify(edit.compactPart(part), null, 2) + "\n");
  }

  /**
   * 검증하고, 스키마 오류가 없으면 쓴다. 수식·커널 오류는 쓰되 features로 알린다. 쓰지 않았으면 isError.
   * extra는 성공 응답에 덧붙일 필드(update_feature의 최종 id 등).
   */
  async function validateAndWrite(
    path: string,
    candidate: unknown,
    extra: Record<string, unknown> = {},
  ): Promise<CallToolResult> {
    const result = await validatePart(candidate);
    if (result.schema.length > 0) return fail({ written: false, ...result });
    const { part } = parsePart(candidate);
    if (!part) throw new Error("검증을 통과한 모델을 다시 파싱하지 못했습니다."); // validatePart와 parsePart가 같은 스키마를 쓰므로 일어나지 않는다
    write(path, part);
    return text({ written: true, path, ...extra, ...result });
  }

  /**
   * 현재 파일을 읽어 편집 함수를 적용한 뒤 validateAndWrite. 파일이 깨져 있으면 거부한다.
   * fn의 결과는 검증 전 느슨한 객체일 수 있으므로(add_feature의 미검증 피처) compactPart는 쓰기 시점에만 적용한다.
   */
  async function editFile(
    path: string | undefined,
    fn: (part: Part) => { part: Part; extra?: Record<string, unknown> },
  ): Promise<CallToolResult> {
    const p = resolvePath(path);
    const { part, schema } = parsePart(readText(p));
    if (!part) return fail({ written: false, message: BROKEN_FILE, schema });
    const edited = fn(part);
    return validateAndWrite(p, edited.part, edited.extra);
  }

  function findFeature(part: Part, id: string): Feature {
    const feature = part.features.find((f) => f.id === id);
    if (!feature) throw new Error(`피처가 없습니다: ${id}`);
    return feature;
  }

  server.registerTool(
    "get_model",
    {
      description:
        "현재 모델 파일을 읽는다. 편집 전에 항상 먼저 호출해 최신 상태(사용자가 UI에서 바꿨을 수 있음)를 본다. " +
        "파일에 스키마 오류가 있으면 model 대신 schema(오류)와 raw(원문)를 돌려준다.",
      inputSchema: { path: pathArg },
      annotations: READ_ONLY,
    },
    ({ path }) =>
      guard(async () => {
        const p = resolvePath(path);
        const raw = readText(p);
        const { part, schema } = parsePart(raw);
        return text(part ? { path: p, model: edit.compactPart(part) } : { path: p, schema, raw });
      }),
  );

  server.registerTool(
    "validate",
    {
      description:
        "모델을 검증한다(스키마 → 수식 → 커널). model을 주면 파일을 건드리지 않고 그 모델을 검증한다(쓰기 전 시험용). " +
        "오류·치수·부피·프린트 경고를 돌려준다.",
      inputSchema: { path: pathArg, model: modelArg.optional() },
      annotations: READ_ONLY,
    },
    ({ path, model }) => guard(async () => text(await validatePart(model ?? readText(resolvePath(path))))),
  );

  server.registerTool(
    "write_model",
    {
      description:
        "모델 전체를 검증 후 파일에 쓴다. 스키마 오류면 쓰지 않는다. 수식·커널 오류는 쓰되 features로 알리니 고쳐서 다시 쓴다.",
      inputSchema: { model: modelArg, path: pathArg },
      annotations: DESTRUCTIVE,
    },
    ({ model, path }) => guard(() => validateAndWrite(resolvePath(path), model)),
  );

  server.registerTool(
    "set_parameter",
    {
      description:
        "parameters의 변수 하나를 바꾸거나, 없으면 새로 만든다(숫자만). 치수 변경은 피처를 고치지 말고 이것을 먼저 쓴다. " +
        "변수 삭제는 write_model로.",
      inputSchema: { name: nameArg, value: z.number(), path: pathArg },
      annotations: SAFE_EDIT,
    },
    ({ name, value, path }) =>
      guard(() => editFile(path, (part) => ({ part: edit.setParameter(part, name, value) }))),
  );

  server.registerTool(
    "add_feature",
    {
      description:
        "피처를 추가한다. index를 주면 그 위치(0부터), 없으면 끝. index가 범위를 넘으면 끝에 붙는다. id는 유일해야 한다.",
      inputSchema: { feature: featureArg, index: z.number().int().min(0).optional(), path: pathArg },
      annotations: SAFE_EDIT,
    },
    ({ feature, index, path }) =>
      guard(() =>
        editFile(path, (part) => {
          const features = [...part.features];
          // 검증 전 캐스팅. 바로 validatePart(PartSchema)로 가므로 잘못된 피처는 스키마 오류로 거부된다.
          features.splice(index ?? features.length, 0, feature as Feature);
          return { part: { ...part, features } };
        }),
      ),
  );

  server.registerTool(
    "update_feature",
    {
      description:
        "id가 일치하는 피처에 patch를 얕게 병합한다(type 변경 불가). suppressed: true로 끌 수 있다. " +
        "id를 바꾸려면 patch.id (중복이면 거부). 응답의 id가 최종 id다.",
      inputSchema: { id: z.string(), patch: z.record(z.string(), z.unknown()), path: pathArg },
      annotations: SAFE_EDIT,
    },
    ({ id, patch, path }) =>
      guard(() =>
        editFile(path, (part) => {
          const current = findFeature(part, id);
          // 스키마 검증을 우연히 통과해 모델이 뒤바뀌는 일을 막는다
          if ("type" in patch && patch.type !== current.type) throw new Error(TYPE_CHANGE);
          // patch.id가 문자열이 아니면 스키마 검증에서 거부된다
          const finalId = typeof patch.id === "string" ? patch.id : id;
          return { part: edit.updateFeature(part, id, patch as edit.FeaturePatch), extra: { id: finalId } };
        }),
      ),
  );

  server.registerTool(
    "delete_feature",
    {
      description: "id가 일치하는 피처를 지운다.",
      inputSchema: { id: z.string(), path: pathArg },
      annotations: DESTRUCTIVE,
    },
    ({ id, path }) =>
      guard(() =>
        editFile(path, (part) => {
          findFeature(part, id);
          return { part: edit.deleteFeature(part, id) };
        }),
      ),
  );

  server.registerTool(
    "screenshot",
    {
      description:
        "브라우저 뷰어의 현재 3D 화면을 PNG로 받는다. 편집 결과를 눈으로 확인할 때 쓴다. " +
        "브라우저(http://localhost:5173)가 열려 있어야 한다.",
      inputSchema: { path: pathArg },
      annotations: READ_ONLY,
    },
    ({ path }) =>
      guard(async () => {
        const p = resolvePath(path);
        const raw = readText(p);
        const result = await validatePart(raw);
        if (result.schema.length > 0) {
          return fail({ message: "스키마 오류가 있어 뷰어가 이 모델을 보여줄 수 없습니다.", ...result });
        }
        const dataUrl = await deps.screenshot(raw);
        const base64 = dataUrl.replace(/^data:image\/png;base64,/, "");
        return {
          content: [
            { type: "image", data: base64, mimeType: "image/png" },
            { type: "text", text: JSON.stringify(result, null, 1) },
          ],
        };
      }),
  );

  server.registerResource(
    "schema",
    "doc://3designer/schema",
    { description: "모델 파일(*.3d.json) 스키마 설명", mimeType: "text/markdown" },
    async (uri) => ({ contents: [{ uri: uri.href, text: deps.schemaDoc(), mimeType: "text/markdown" }] }),
  );

  return server;
}
