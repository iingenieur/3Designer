import type { ClientMessage, ServerMessage } from "../../server/protocol";

const URL = `ws://${location.hostname}:5174`;
const RECONNECT_MS = 2000;

export type ConnectionStatus = "connecting" | "open" | "closed";

/** 서버와의 WebSocket 연결. 끊기면 2초마다 재접속한다. */
export class Connection {
  private socket: WebSocket | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private closed = false;

  constructor(
    private readonly onMessage: (m: ServerMessage) => void,
    private readonly onStatus: (s: ConnectionStatus) => void,
  ) {
    this.connect();
  }

  private connect() {
    if (this.closed) return;
    this.onStatus("connecting");
    const socket = new WebSocket(URL);
    this.socket = socket;
    socket.onopen = () => this.onStatus("open");
    socket.onmessage = (e) => this.onMessage(JSON.parse(e.data) as ServerMessage);
    socket.onclose = () => {
      this.onStatus("closed");
      if (this.closed) return;
      this.reconnectTimer = setTimeout(() => this.connect(), RECONNECT_MS);
    };
    socket.onerror = () => socket.close();
  }

  send(message: ClientMessage) {
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(message));
  }

  /** 재접속을 멈추고 소켓을 닫는다 (HMR 폐기용). */
  close() {
    this.closed = true;
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.socket?.close();
    this.socket = null;
  }
}
