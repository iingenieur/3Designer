import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { WebSocketServer, type WebSocket, type AddressInfo } from "ws";
import { AgentConnection } from "./agentConnection";
import type { ClientMessage, ServerMessage } from "./protocol";

/** 가짜 감시 서버 쪽에서 본 에이전트 연결 하나 */
interface Peer {
  socket: WebSocket;
  send(m: ServerMessage): void;
  /** 에이전트가 보낸 메시지를 순서대로 하나씩 꺼낸다(아직 안 왔으면 기다린다). */
  next(): Promise<ClientMessage>;
}

let wss: WebSocketServer;
let conn: AgentConnection | undefined;
let connections = 0;

function url() {
  return `ws://localhost:${(wss.address() as AddressInfo).port}`;
}

/** 다음 연결을 받아 Peer로 감싼다. 연결 전에 호출해 두어야 한다. */
function accept(): Promise<Peer> {
  return new Promise((resolve) => {
    wss.once("connection", (socket) => {
      const messages: ClientMessage[] = [];
      const waiters: ((m: ClientMessage) => void)[] = [];
      let consumed = 0;
      socket.on("message", (raw) => {
        const m = JSON.parse(String(raw)) as ClientMessage;
        messages.push(m);
        waiters.shift()?.(m);
      });
      resolve({
        socket,
        send: (m) => socket.send(JSON.stringify(m)),
        next: () => {
          if (consumed < messages.length) return Promise.resolve(messages[consumed++]);
          consumed++;
          return new Promise((r) => waiters.push(r));
        },
      });
    });
  });
}

/** 접속해서 hello까지 주고받은 상태의 연결을 만든다 */
async function connect(reconnectMs = 50, timeoutMs = 1000): Promise<Peer> {
  const peerP = accept();
  conn = new AgentConnection(url(), reconnectMs, timeoutMs);
  const peer = await peerP;
  expect(await peer.next()).toEqual({ kind: "hello", role: "agent" });
  return peer;
}

function requestId(m: ClientMessage): number {
  if (m.kind !== "screenshotRequest") throw new Error(`screenshotRequest가 아님: ${m.kind}`);
  return m.id;
}

beforeEach(async () => {
  connections = 0;
  wss = new WebSocketServer({ port: 0 });
  wss.on("connection", () => connections++);
  await new Promise((r) => wss.once("listening", r));
});

afterEach(async () => {
  conn?.close();
  conn = undefined;
  for (const c of wss.clients) c.terminate();
  await new Promise((r) => wss.close(r));
});

describe("AgentConnection", () => {
  it("접속하면 hello agent를 보내고, file을 받으면 path가 채워진다", async () => {
    const peer = await connect();
    expect(conn!.connected).toBe(true);
    expect(conn!.path).toBeNull();
    peer.send({ kind: "file", path: "/tmp/a.3d.json", text: "{}" });
    await vi.waitFor(() => expect(conn!.path).toBe("/tmp/a.3d.json"));
  });

  it("screenshot은 screenshotRequest를 보내고 screenshot 응답으로 resolve된다", async () => {
    const peer = await connect();
    const p = conn!.screenshot("{}");
    const req = await peer.next();
    expect(req).toEqual({ kind: "screenshotRequest", id: expect.any(Number), text: "{}" });
    peer.send({ kind: "screenshot", id: requestId(req), dataUrl: "data:image/png;base64,AAA" });
    await expect(p).resolves.toBe("data:image/png;base64,AAA");
  });

  it("요청마다 id가 다르고 각자 제 응답을 받는다", async () => {
    const peer = await connect();
    const p1 = conn!.screenshot("1");
    const p2 = conn!.screenshot("2");
    const id1 = requestId(await peer.next());
    const id2 = requestId(await peer.next());
    expect(id1).not.toBe(id2);
    peer.send({ kind: "screenshot", id: id2, dataUrl: "two" });
    peer.send({ kind: "screenshot", id: id1, dataUrl: "one" });
    await expect(p1).resolves.toBe("one");
    await expect(p2).resolves.toBe("two");
  });

  it("screenshotFailed면 그 메시지로 reject된다", async () => {
    const peer = await connect();
    const p = conn!.screenshot("{}");
    const req = await peer.next();
    peer.send({ kind: "screenshotFailed", id: requestId(req), message: "브라우저(뷰어)가 연결되어 있지 않습니다." });
    await expect(p).rejects.toThrow("브라우저(뷰어)가 연결되어 있지 않습니다.");
  });

  it("모르는 id의 응답과 깨진 메시지는 무시한다", async () => {
    const peer = await connect();
    peer.socket.send("이건 JSON이 아니다");
    peer.send({ kind: "screenshot", id: 999, dataUrl: "x" });
    const p = conn!.screenshot("{}");
    const req = await peer.next();
    peer.send({ kind: "screenshot", id: requestId(req), dataUrl: "ok" });
    await expect(p).resolves.toBe("ok");
  });

  it("연결되기 전에는 screenshot이 연결 안내로 reject된다", async () => {
    conn = new AgentConnection(url(), 50, 1000);
    expect(conn.connected).toBe(false);
    await expect(conn.screenshot("{}")).rejects.toThrow(/연결되어 있지 않습니다.*npm start/);
  });

  it("응답이 없으면 시간 초과로 reject된다", async () => {
    const peer = await connect(50, 30);
    const p = conn!.screenshot("{}");
    await peer.next();
    await expect(p).rejects.toThrow("시간 초과");
  });

  it("서버가 끊으면 대기 중 요청이 reject되고 path가 비워지며, 잠시 뒤 다시 붙어 hello를 보낸다", async () => {
    const peer = await connect(50);
    peer.send({ kind: "file", path: "/tmp/a.3d.json", text: "{}" });
    await vi.waitFor(() => expect(conn!.path).toBe("/tmp/a.3d.json"));
    const p = conn!.screenshot("{}");
    await peer.next();

    const again = accept();
    peer.socket.close();
    await expect(p).rejects.toThrow("끊겼습니다");
    expect(conn!.path).toBeNull();
    expect(conn!.connected).toBe(false);
    await expect(conn!.screenshot("{}")).rejects.toThrow("연결되어 있지 않습니다");

    const peer2 = await again;
    expect(await peer2.next()).toEqual({ kind: "hello", role: "agent" });
    expect(connections).toBe(2);
    peer2.send({ kind: "file", path: "/tmp/b.3d.json", text: "{}" });
    await vi.waitFor(() => expect(conn!.path).toBe("/tmp/b.3d.json"));
  });

  it("서버가 없으면 재접속을 반복하다가 서버가 생기면 붙는다", async () => {
    const port = (wss.address() as AddressInfo).port;
    await new Promise((r) => wss.close(r));
    conn = new AgentConnection(`ws://localhost:${port}`, 30, 1000);
    await new Promise((r) => setTimeout(r, 100)); // 몇 번 실패한다 (unhandled error가 나지 않아야 한다)
    expect(conn.connected).toBe(false);
    wss = new WebSocketServer({ port });
    const peer = await accept();
    expect(await peer.next()).toEqual({ kind: "hello", role: "agent" });
  });

  it("close() 후에는 재접속하지 않는다", async () => {
    const peer = await connect(30);
    const closed = new Promise((r) => peer.socket.once("close", r));
    conn!.close();
    await closed;
    await new Promise((r) => setTimeout(r, 120));
    expect(connections).toBe(1);
    expect(conn!.connected).toBe(false);
  });

  it("접속 중(CONNECTING)에 close()해도 재접속하지 않는다", async () => {
    conn = new AgentConnection(url(), 30, 1000);
    conn.close();
    await new Promise((r) => setTimeout(r, 120));
    expect(conn.connected).toBe(false);
    expect(wss.clients.size).toBe(0);
  });
});
