import WebSocket from "ws";
import type { ClientMessage, ServerMessage } from "./protocol";

const RECONNECT_MS = 2000;
const SCREENSHOT_TIMEOUT_MS = 15_000;

interface PendingShot {
  resolve: (dataUrl: string) => void;
  reject: (e: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

/**
 * MCP 프로세스가 감시 서버(server/index.ts)에 붙는 에이전트 클라이언트.
 * 서버가 감시 중인 파일 경로를 기억하고, 뷰어 스크린샷을 요청한다. 끊기면 reconnectMs마다 재접속한다.
 * 재접속 타이머는 unref라 프로세스 종료를 막지 않는다.
 */
export class AgentConnection {
  /** 서버가 감시 중인 모델 파일. 아직 못 받았거나 끊겼으면 null. */
  path: string | null = null;
  private socket: WebSocket | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private seq = 0;
  private pending = new Map<number, PendingShot>();
  private closed = false;

  constructor(
    private readonly url: string,
    private readonly reconnectMs = RECONNECT_MS,
    private readonly timeoutMs = SCREENSHOT_TIMEOUT_MS,
  ) {
    this.connect();
  }

  get connected(): boolean {
    return this.socket?.readyState === WebSocket.OPEN;
  }

  private connect() {
    if (this.closed) return;
    this.reconnectTimer = null;
    const socket = new WebSocket(this.url);
    this.socket = socket;
    socket.on("open", () => this.send({ kind: "hello", role: "agent" }));
    socket.on("message", (raw) => {
      let m: ServerMessage;
      try {
        m = JSON.parse(String(raw)) as ServerMessage;
      } catch {
        return;
      }
      if (m && typeof m === "object") this.onMessage(m);
    });
    // 연결 실패(ECONNREFUSED 등)는 error 뒤에 close가 따라온다. 리스너가 없으면 ws가 예외를 던지므로 반드시 둔다.
    socket.on("error", () => {});
    socket.on("close", () => {
      if (this.socket !== socket) return; // 이미 다른 소켓으로 넘어갔다
      this.path = null;
      for (const [id, p] of this.pending) {
        clearTimeout(p.timer);
        p.reject(new Error("뷰어 서버 연결이 끊겼습니다."));
        this.pending.delete(id);
      }
      if (!this.closed) {
        this.reconnectTimer = setTimeout(() => this.connect(), this.reconnectMs);
        this.reconnectTimer.unref();
      }
    });
  }

  private onMessage(m: ServerMessage) {
    if (m.kind === "file") this.path = m.path;
    else if (m.kind === "screenshot") this.settle(m.id, (p) => p.resolve(m.dataUrl));
    else if (m.kind === "screenshotFailed") this.settle(m.id, (p) => p.reject(new Error(m.message)));
  }

  private settle(id: number, fn: (p: PendingShot) => void) {
    const p = this.pending.get(id);
    if (!p) return;
    clearTimeout(p.timer);
    this.pending.delete(id);
    fn(p);
  }

  private send(m: ClientMessage) {
    if (this.connected) this.socket!.send(JSON.stringify(m));
  }

  /** 뷰어 스크린샷(PNG data URL). text는 캡처 전에 뷰어가 반영해야 할 파일 내용. */
  screenshot(text: string): Promise<string> {
    if (!this.connected) {
      return Promise.reject(
        new Error(`뷰어 서버(${this.url})에 연결되어 있지 않습니다. \`npm start -- <모델>\`로 서버와 브라우저를 켜세요.`),
      );
    }
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => this.settle(id, (p) => p.reject(new Error("스크린샷 응답 시간 초과"))), this.timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.send({ kind: "screenshotRequest", id, text });
    });
  }

  /** 연결을 끊고 더 이상 재접속하지 않는다. */
  close() {
    this.closed = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.socket?.close();
  }
}
