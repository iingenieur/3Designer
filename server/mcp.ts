/**
 * Claude Code가 stdio로 띄우는 3Designer MCP 서버 진입점(.mcp.json 참조).
 * 도구 본체는 mcpServer.ts, 감시 서버(npm start)와의 통신은 agentConnection.ts.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createMcpServer } from "./mcpServer";
import { AgentConnection } from "./agentConnection";

// stdout은 MCP 전송 전용이다. 어떤 로그도 stderr로.
console.log = console.info = console.debug = (...args: unknown[]) => console.error(...args);

const PORT = Number(process.env.PORT ?? 5174);
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const agent = new AgentConnection(`ws://localhost:${PORT}`, { log: (m) => console.error(m) });

const server = createMcpServer({
  defaultPath: () => agent.path,
  screenshot: (text) => agent.screenshot(text),
  schemaDoc: () => readFileSync(join(root, "docs/schema.md"), "utf8"),
  onFatalKernelError: (e) => {
    console.error(`커널 런타임 손상, MCP 서버를 종료합니다. Claude Code에서 /mcp 로 다시 연결하세요: ${String(e)}`);
    // 응답이 먼저 나가도록 종료를 다음 틱으로 미룬다. transport.close()가 stdin을 멈추고 agent.close()로 소켓이 닫히면
    // 남은 핸들이 없어 stdout을 다 쓴 뒤 자연 종료된다(process.exit는 쓰기 중인 stdout을 자를 수 있다).
    setTimeout(() => {
      agent.close();
      void server.close();
      process.exitCode = 1;
    }, 0);
  },
});

// Claude Code가 stdin을 닫으면 종료한다. 재접속 타이머는 unref라 종료를 막지 않지만 열린 소켓은 막으므로 명시적으로 끝낸다.
process.stdin.on("end", () => {
  agent.close();
  process.exit(0);
});
await server.connect(new StdioServerTransport());
console.error(`3Designer MCP 서버 시작 (뷰어 서버 ws://localhost:${PORT})`);
