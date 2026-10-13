import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

/**
 * 실제 프로세스(npx tsx server/mcp.ts)를 stdio로 띄워 본다.
 * 커널 로드가 stdout을 더럽히지 않는지, 감시 서버가 없어도 도구가 동작하는지, 종료 시 프로세스가 남지 않는지 확인한다.
 */
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
let client: Client;
let transport: StdioClientTransport;
let stderr = "";

function textOf(result: unknown): string {
  const content = (result as { content: { type: string; text?: string }[] }).content;
  return content.find((c) => c.type === "text")?.text ?? "";
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

beforeAll(async () => {
  client = new Client({ name: "e2e", version: "0" });
  // PORT=1: 감시 서버가 없는 상황. 재접속 시도는 실패해도 도구는 동작해야 한다.
  // env에 process.env를 펼쳐야 npx가 PATH를 찾는다.
  transport = new StdioClientTransport({
    command: "npx",
    args: ["tsx", "server/mcp.ts"],
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

  it("로그는 stderr로만 나간다", () => {
    expect(stderr).toContain("3Designer MCP 서버 시작");
  });

  it("클라이언트를 닫으면 프로세스가 종료된다", async () => {
    const pid = transport.pid;
    expect(pid).not.toBeNull();
    await client.close();
    await vi.waitFor(() => expect(alive(pid!)).toBe(false), { timeout: 10_000 });
  });
});
