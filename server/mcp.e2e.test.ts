import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { WebSocketServer, type AddressInfo } from "ws";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

/**
 * 실제 프로세스(node --import tsx server/mcp.ts, .mcp.json과 같은 명령)를 stdio로 띄워 본다.
 * 커널 로드가 stdout을 더럽히지 않는지, 감시 서버가 없어도 도구가 동작하는지, stdin이 닫히면 바로 끝나는지 확인한다.
 */
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const COMMAND = "node";
const ARGS = ["--import", "tsx", "server/mcp.ts"];
let client: Client;
let transport: StdioClientTransport;
let stderr = "";
/** stdout에 JSON-RPC가 아닌 줄이 섞이면 SDK는 예외 대신 onerror로 알린다. 비어 있어야 stdout이 깨끗한 것이다. */
const errors: Error[] = [];

function textOf(result: unknown): string {
  const content = (result as { content: { type: string; text?: string }[] }).content;
  return content.find((c) => c.type === "text")?.text ?? "";
}

beforeAll(async () => {
  client = new Client({ name: "e2e", version: "0" });
  client.onerror = (e) => errors.push(e);
  // PORT=1: 감시 서버가 없는 상황. 재접속 시도는 실패해도 도구는 동작해야 한다.
  // env에 process.env를 펼치는 이유: SDK 기본 env는 PATH 등 몇 개만 넘기므로 nvm/NODE_OPTIONS 같은 설정을 상속시킨다.
  transport = new StdioClientTransport({
    command: COMMAND,
    args: ARGS,
    cwd: root,
    env: { ...process.env, PORT: "1" },
    stderr: "pipe",
  });
  transport.stderr?.on("data", (chunk: Buffer) => (stderr += String(chunk)));
  await client.connect(transport);
});

afterAll(async () => {
  await client.close();
});

describe("stdio MCP 서버", () => {
  it("도구 8개를 나열한다", async () => {
    const names = (await client.listTools()).tools.map((t) => t.name).sort();
    expect(names).toEqual(
      ["add_feature", "delete_feature", "get_model", "screenshot", "set_parameter", "update_feature", "validate", "write_model"],
    );
  });

  it("path로 플랜지를 검증한다 (커널이 stdio를 더럽히지 않는다)", async () => {
    const r = await client.callTool({ name: "validate", arguments: { path: "examples/flange.3d.json" } });
    expect(r.isError).toBeFalsy();
    const body = JSON.parse(textOf(r));
    expect(body.ok).toBe(true);
    expect(body.measurements.size).toEqual([40, 40, 14]);
  });

  it("경로 없이 호출하면 서버를 켜라고 한다", async () => {
    const r = await client.callTool({ name: "get_model", arguments: {} });
    expect(r.isError).toBe(true);
    expect(textOf(r)).toMatch(/npm start/);
  });

  it("뷰어 서버가 없으면 screenshot은 연결 오류", async () => {
    const r = await client.callTool({ name: "screenshot", arguments: { path: "examples/flange.3d.json" } });
    expect(r.isError).toBe(true);
    expect(textOf(r)).toMatch(/연결되어 있지 않/);
  });

  it("리소스로 스키마 문서를 읽는다", async () => {
    const [first] = (await client.readResource({ uri: "doc://3designer/schema" })).contents;
    expect("text" in first && first.text).toContain("# 3Designer 모델 파일 스키마");
  });

  it("로그는 stderr로만 나가고 stdout에는 JSON-RPC 외의 줄이 없다", async () => {
    await vi.waitFor(() => expect(stderr).toContain("3Designer MCP 서버 시작"));
    expect(errors).toEqual([]);
  });
});

describe("stdio MCP 서버 종료", () => {
  it("감시 서버에 붙어 있어도 stdin이 닫히면 1초 안에 exit 0으로 끝난다", async () => {
    const wss = new WebSocketServer({ port: 0 });
    await new Promise((r) => wss.once("listening", r));
    const port = (wss.address() as AddressInfo).port;
    const hello = new Promise<string>((resolve) => {
      wss.once("connection", (socket) => socket.once("message", (raw) => resolve(String(raw))));
    });
    const child = spawn(COMMAND, ARGS, { cwd: root, env: { ...process.env, PORT: String(port) }, stdio: ["pipe", "pipe", "pipe"] });
    child.stdout.resume();
    child.stderr.resume();
    const exited = new Promise<number | null>((resolve) => child.once("exit", (code) => resolve(code)));
    try {
      expect(JSON.parse(await hello)).toEqual({ kind: "hello", role: "agent" }); // 열린 소켓이 있는 상태
      const started = Date.now();
      child.stdin.end();
      const code = await Promise.race([exited, new Promise<"timeout">((r) => setTimeout(() => r("timeout"), 1000))]);
      expect(code).toBe(0);
      expect(Date.now() - started).toBeLessThan(1000);
    } finally {
      child.kill();
      for (const c of wss.clients) c.terminate();
      await new Promise((r) => wss.close(r));
    }
  });
});
