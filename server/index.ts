import { resolve } from "node:path";
import { existsSync } from "node:fs";
import { watch } from "chokidar";
import { WebSocketServer, WebSocket } from "ws";
import { ProjectFile } from "./projectFile";
import type { ClientMessage, ServerMessage } from "./protocol";

const PORT = Number(process.env.PORT ?? 5174);
const arg = process.argv[2];
if (!arg) {
  console.error("사용법: npm run serve -- <모델파일.3d.json>");
  process.exit(1);
}
const path = resolve(arg);
if (!existsSync(path)) {
  console.error(`파일이 없습니다: ${path}`);
  process.exit(1);
}

const file = new ProjectFile(path);
const wss = new WebSocketServer({
  port: PORT,
  // 다른 사이트의 페이지가 로컬 파일 서버에 붙지 못하게 한다. 브라우저가 보내는 Origin만 검사하고, 없으면(비브라우저 클라이언트) 통과.
  verifyClient: ({ origin }: { origin: string }) => !origin || origin.startsWith("http://localhost:") || origin.startsWith("http://127.0.0.1:"),
});

wss.on("error", (e: NodeJS.ErrnoException) => {
  if (e.code === "EADDRINUSE") {
    console.error(`포트 ${PORT}가 이미 사용 중입니다. 다른 3Designer 서버가 떠 있는지 확인하거나 PORT=<번호>로 서버를, VITE_WS_PORT=<번호>로 뷰어를 실행하세요.`);
  } else {
    console.error(`서버 오류: ${e.message}`);
  }
  process.exit(1);
});

function broadcast(message: ServerMessage) {
  const text = JSON.stringify(message);
  for (const client of wss.clients) if (client.readyState === WebSocket.OPEN) client.send(text);
}

/** 파일 내용을 한 클라이언트에, 또는 모두에게 보낸다. */
function sendFile(to?: WebSocket) {
  let message: ServerMessage;
  try {
    message = { kind: "file", path, text: file.read() };
  } catch (e) {
    message = { kind: "fileError", message: String(e) };
  }
  if (to) to.send(JSON.stringify(message));
  else broadcast(message);
}

wss.on("connection", (socket) => {
  sendFile(socket);
  socket.on("message", (raw) => {
    let message: ClientMessage;
    try {
      message = JSON.parse(String(raw)) as ClientMessage;
    } catch {
      return;
    }
    if (message.kind === "save") {
      if (file.write(message.part)) console.log("저장됨 (UI 편집)");
    } else if (message.kind === "errors") {
      file.writeErrors(message.errors);
    }
  });
});

/** 디스크 변경을 브라우저에 전달한다. 에디터가 파일을 통째로 바꿔치기하면 change 대신 unlink+add가 올 수 있어 add도 듣는다. */
function onDiskChange() {
  let text: string;
  try {
    text = file.read();
  } catch {
    return;
  }
  if (file.isOwnContent(text)) return; // UI 편집이 되돌아온 것
  console.log("파일 변경 감지 → 브라우저에 전송");
  broadcast({ kind: "file", path, text });
}

watch(path, { ignoreInitial: true, awaitWriteFinish: { stabilityThreshold: 100, pollInterval: 50 } })
  .on("change", onDiskChange)
  .on("add", onDiskChange);

wss.on("listening", () => {
  console.log(`3Designer 서버: ws://localhost:${PORT}  감시 중: ${path}`);
});
