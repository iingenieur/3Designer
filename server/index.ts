import { dirname } from "node:path";
import { watch, type FSWatcher } from "chokidar";
import { WebSocketServer, WebSocket } from "ws";
import { ProjectFile } from "./projectFile";
import { ScreenshotRelay, type Send } from "./relay";
import { listModels, resolveModel, pickInitialModel } from "./modelDir";
import type { ClientMessage, ServerMessage } from "./protocol";

const PORT = Number(process.env.PORT ?? 5174);
const arg = process.argv[2];
if (!arg) {
  console.error("사용법: npm run serve -- <모델파일.3d.json 또는 모델 폴더>");
  process.exit(1);
}
const initial = pickInitialModel(arg);
if (!initial) {
  console.error(`모델 파일이 없습니다: ${arg} (*.3d.json 파일 또는 그런 파일이 든 폴더를 주세요)`);
  process.exit(1);
}

/** 모델 폴더. 뷰어는 이 폴더 안의 모델만 골라 열 수 있다. */
const dir = dirname(initial);
let file = new ProjectFile(initial);
let fileWatcher: FSWatcher | null = null;
const relay = new ScreenshotRelay();
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

/** 파일 내용을 한 클라이언트에, 또는 모두에게 보낸다. 에이전트도 경로를 알아야 하므로 역할을 가리지 않는다. */
function sendFile(to?: Send) {
  let message: ServerMessage;
  try {
    message = { kind: "file", path: file.path, text: file.read() };
  } catch (e) {
    message = { kind: "fileError", message: String(e) };
  }
  if (to) to(message);
  else broadcast(message);
}

function sendFiles(to?: Send) {
  const message: ServerMessage = { kind: "files", dir, files: listModels(dir) };
  if (to) to(message);
  else broadcast(message);
}

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
  broadcast({ kind: "file", path: file.path, text });
}

/** 감시 대상을 바꾼다. 이전 파일의 감시를 멈추고 새 파일을 감시하며, 모두에게 새 내용을 보낸다. */
function openFile(path: string) {
  void fileWatcher?.close();
  file = new ProjectFile(path);
  fileWatcher = watch(path, { ignoreInitial: true, awaitWriteFinish: { stabilityThreshold: 100, pollInterval: 50 } })
    .on("change", onDiskChange)
    .on("add", onDiskChange);
}

wss.on("connection", (socket) => {
  // 연결마다 하나뿐인 send 함수. 중계기가 이것으로 연결을 식별하므로 다시 만들지 않는다.
  const send: Send = (m) => {
    if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(m));
  };
  sendFile(send);
  sendFiles(send);
  socket.on("message", (raw) => {
    let message: ClientMessage;
    try {
      message = JSON.parse(String(raw)) as ClientMessage;
    } catch {
      return;
    }
    if (!message || typeof message !== "object") return; // null, 숫자 같은 비객체 JSON
    switch (message.kind) {
      case "hello":
        if (message.role === "viewer") {
          relay.addViewer(send);
          console.log("뷰어 연결");
        } else if (message.role === "agent") {
          console.log("에이전트 연결");
        }
        break;
      case "save":
        if (file.write(message.part)) console.log("저장됨 (UI 편집)");
        break;
      case "errors":
        file.writeErrors(message.errors);
        break;
      case "open": {
        const path = typeof message.file === "string" ? resolveModel(dir, message.file) : null;
        if (!path) {
          console.log(`열 수 없는 모델 이름: ${String(message.file)}`);
          break;
        }
        if (path === file.path) break;
        openFile(path);
        console.log(`모델 전환: ${path}`);
        sendFile();
        break;
      }
      case "screenshotRequest":
        relay.request(send, message.id, message.text);
        break;
      case "screenshot":
        relay.resolve(send, message.id, message.dataUrl);
        break;
      case "screenshotFailed":
        relay.reject(send, message.id, message.message);
        break;
      // 알 수 없는 kind는 무시
    }
  });
  socket.on("close", () => relay.removeClient(send));
});

openFile(initial);

// 폴더에 모델이 생기거나 사라지면 목록을 다시 보낸다. 내용 변경은 파일 감시가 맡는다.
watch(dir, { ignoreInitial: true, depth: 0 })
  .on("add", (p) => p.endsWith(".3d.json") && sendFiles())
  .on("unlink", (p) => p.endsWith(".3d.json") && sendFiles());

wss.on("listening", () => {
  console.log(`3Designer 서버: ws://localhost:${PORT}  감시 중: ${file.path}  (폴더 모델 ${listModels(dir).length}개)`);
});
