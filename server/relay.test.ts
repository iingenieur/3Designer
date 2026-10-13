import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ScreenshotRelay } from "./relay";
import type { ServerMessage } from "./protocol";

function fakeClient() {
  const sent: ServerMessage[] = [];
  return { sent, send: (m: ServerMessage) => void sent.push(m) };
}

/** 뷰어가 받은 n번째 메시지의 서버 쪽 요청 id */
function requestId(viewer: ReturnType<typeof fakeClient>, index = 0): number {
  const m = viewer.sent[index];
  if (m.kind !== "screenshotRequest") throw new Error(`screenshotRequest가 아님: ${m.kind}`);
  return m.id;
}

describe("ScreenshotRelay", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("뷰어가 없으면 즉시 실패를 돌려준다", () => {
    const relay = new ScreenshotRelay(1000);
    const agent = fakeClient();
    relay.request(agent.send, 7, undefined);
    expect(agent.sent).toEqual([{ kind: "screenshotFailed", id: 7, message: expect.stringContaining("브라우저") }]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("뷰어에게 요청을 보내고 답을 에이전트 id로 돌려준다", () => {
    const relay = new ScreenshotRelay(1000);
    const viewer = fakeClient();
    const agent = fakeClient();
    relay.addViewer(viewer.send);
    relay.request(agent.send, 7, "{}");
    expect(viewer.sent).toHaveLength(1);
    const req = viewer.sent[0];
    expect(req).toMatchObject({ kind: "screenshotRequest", text: "{}" });
    expect(agent.sent).toEqual([]);
    relay.resolve(viewer.send, requestId(viewer), "data:image/png;base64,AAA");
    expect(agent.sent).toEqual([{ kind: "screenshot", id: 7, dataUrl: "data:image/png;base64,AAA" }]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("text 없이 요청하면 뷰어에게도 text 없이 간다", () => {
    const relay = new ScreenshotRelay(1000);
    const viewer = fakeClient();
    const agent = fakeClient();
    relay.addViewer(viewer.send);
    relay.request(agent.send, 1, undefined);
    expect(viewer.sent[0]).toMatchObject({ kind: "screenshotRequest" });
    expect((viewer.sent[0] as { text?: string }).text).toBeUndefined();
  });

  it("뷰어 실패를 전달한다", () => {
    const relay = new ScreenshotRelay(1000);
    const viewer = fakeClient();
    const agent = fakeClient();
    relay.addViewer(viewer.send);
    relay.request(agent.send, 7, undefined);
    relay.reject(viewer.send, requestId(viewer), "캡처 실패");
    expect(agent.sent).toEqual([{ kind: "screenshotFailed", id: 7, message: "캡처 실패" }]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("시간이 지나면 실패로 끝내고 늦은 답은 무시한다", () => {
    const relay = new ScreenshotRelay(1000);
    const viewer = fakeClient();
    const agent = fakeClient();
    relay.addViewer(viewer.send);
    relay.request(agent.send, 7, undefined);
    vi.advanceTimersByTime(999);
    expect(agent.sent).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(agent.sent).toEqual([{ kind: "screenshotFailed", id: 7, message: expect.stringContaining("1초") }]);
    relay.resolve(viewer.send, requestId(viewer), "data:image/png;base64,AAA");
    relay.reject(viewer.send, requestId(viewer), "늦은 실패");
    expect(agent.sent).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("뷰어가 끊기면 그 뷰어에게 보낸 대기 요청은 실패한다", () => {
    const relay = new ScreenshotRelay(1000);
    const viewer = fakeClient();
    const agent = fakeClient();
    relay.addViewer(viewer.send);
    relay.request(agent.send, 7, undefined);
    relay.removeClient(viewer.send);
    expect(agent.sent).toEqual([{ kind: "screenshotFailed", id: 7, message: expect.stringContaining("끊") }]);
    expect(vi.getTimerCount()).toBe(0);
    // 끊긴 뒤의 새 요청은 뷰어 없음으로 즉시 실패한다
    relay.request(agent.send, 8, undefined);
    expect(agent.sent[1]).toMatchObject({ kind: "screenshotFailed", id: 8, message: expect.stringContaining("브라우저") });
  });

  it("에이전트가 끊기면 대기 요청을 버린다", () => {
    const relay = new ScreenshotRelay(1000);
    const viewer = fakeClient();
    const agent = fakeClient();
    relay.addViewer(viewer.send);
    relay.request(agent.send, 7, undefined);
    relay.removeClient(agent.send);
    expect(vi.getTimerCount()).toBe(0);
    relay.resolve(viewer.send, requestId(viewer), "data:image/png;base64,AAA");
    expect(agent.sent).toEqual([]);
    // 뷰어는 그대로 남아 다른 에이전트의 요청을 받는다
    const other = fakeClient();
    relay.request(other.send, 1, undefined);
    expect(viewer.sent).toHaveLength(2);
  });

  it("두 뷰어면 모두에게 보내고 첫 응답만 쓴다", () => {
    const relay = new ScreenshotRelay(1000);
    const viewer1 = fakeClient();
    const viewer2 = fakeClient();
    const agent = fakeClient();
    relay.addViewer(viewer1.send);
    relay.addViewer(viewer2.send);
    relay.request(agent.send, 7, "{}");
    expect(viewer1.sent).toHaveLength(1);
    expect(viewer2.sent).toHaveLength(1);
    expect(requestId(viewer1)).toBe(requestId(viewer2));
    relay.resolve(viewer1.send, requestId(viewer1), "data:image/png;base64,ONE");
    relay.resolve(viewer2.send, requestId(viewer2), "data:image/png;base64,TWO");
    expect(agent.sent).toEqual([{ kind: "screenshot", id: 7, dataUrl: "data:image/png;base64,ONE" }]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("뷰어 하나가 끊겨도 다른 뷰어가 남아 있으면 요청은 유지된다", () => {
    const relay = new ScreenshotRelay(1000);
    const viewer1 = fakeClient();
    const viewer2 = fakeClient();
    const agent = fakeClient();
    relay.addViewer(viewer1.send);
    relay.addViewer(viewer2.send);
    relay.request(agent.send, 7, undefined);
    relay.removeClient(viewer1.send);
    expect(agent.sent).toEqual([]);
    expect(vi.getTimerCount()).toBe(1);
    relay.resolve(viewer2.send, requestId(viewer2), "data:image/png;base64,AAA");
    expect(agent.sent).toEqual([{ kind: "screenshot", id: 7, dataUrl: "data:image/png;base64,AAA" }]);
  });

  it("요청 뒤에 들어온 뷰어가 끊겨도 기존 요청에 영향이 없다", () => {
    const relay = new ScreenshotRelay(1000);
    const viewer1 = fakeClient();
    const viewer2 = fakeClient();
    const agent = fakeClient();
    relay.addViewer(viewer1.send);
    relay.request(agent.send, 7, undefined);
    relay.addViewer(viewer2.send);
    expect(viewer2.sent).toEqual([]);
    relay.removeClient(viewer2.send);
    expect(agent.sent).toEqual([]);
    relay.resolve(viewer1.send, requestId(viewer1), "data:image/png;base64,AAA");
    expect(agent.sent).toHaveLength(1);
  });

  it("같은 에이전트의 동시 요청을 각각 id로 구분한다", () => {
    const relay = new ScreenshotRelay(1000);
    const viewer = fakeClient();
    const agent = fakeClient();
    relay.addViewer(viewer.send);
    relay.request(agent.send, 1, undefined);
    relay.request(agent.send, 2, undefined);
    expect(viewer.sent).toHaveLength(2);
    const first = requestId(viewer, 0);
    const second = requestId(viewer, 1);
    expect(first).not.toBe(second);
    relay.resolve(viewer.send, second, "data:image/png;base64,B");
    relay.resolve(viewer.send, first, "data:image/png;base64,A");
    expect(agent.sent).toEqual([
      { kind: "screenshot", id: 2, dataUrl: "data:image/png;base64,B" },
      { kind: "screenshot", id: 1, dataUrl: "data:image/png;base64,A" },
    ]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("모르는 id의 답은 무시하고 대기 중인 요청은 유지된다", () => {
    const relay = new ScreenshotRelay(1000);
    const viewer = fakeClient();
    const agent = fakeClient();
    relay.addViewer(viewer.send);
    relay.request(agent.send, 7, undefined);
    const unknownId = requestId(viewer) + 100;
    relay.resolve(viewer.send, unknownId, "data:image/png;base64,AAA");
    relay.reject(viewer.send, unknownId, "x");
    expect(agent.sent).toEqual([]);
    expect(vi.getTimerCount()).toBe(1);
    relay.resolve(viewer.send, requestId(viewer), "data:image/png;base64,AAA");
    expect(agent.sent).toHaveLength(1);
  });

  it("요청을 받지 않은 클라이언트의 답은 무시하고 대기 중인 요청은 유지된다", () => {
    const relay = new ScreenshotRelay(1000);
    const viewer = fakeClient();
    const agent = fakeClient();
    const stranger = fakeClient();
    relay.addViewer(viewer.send);
    relay.request(agent.send, 7, undefined);
    const id = requestId(viewer);
    // 에이전트 자신, 요청 뒤에 들어온 뷰어, 아무 관계 없는 클라이언트 모두 답할 수 없다
    relay.resolve(agent.send, id, "data:image/png;base64,AAA");
    relay.reject(agent.send, id, "x");
    relay.addViewer(stranger.send);
    relay.resolve(stranger.send, id, "data:image/png;base64,AAA");
    relay.reject(stranger.send, id, "x");
    expect(agent.sent).toEqual([]);
    expect(vi.getTimerCount()).toBe(1);
    relay.resolve(viewer.send, id, "data:image/png;base64,AAA");
    expect(agent.sent).toEqual([{ kind: "screenshot", id: 7, dataUrl: "data:image/png;base64,AAA" }]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("기본 제한 시간은 10초다", () => {
    const relay = new ScreenshotRelay();
    const viewer = fakeClient();
    const agent = fakeClient();
    relay.addViewer(viewer.send);
    relay.request(agent.send, 7, undefined);
    vi.advanceTimersByTime(9_999);
    expect(agent.sent).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(agent.sent).toEqual([{ kind: "screenshotFailed", id: 7, message: expect.stringContaining("10초") }]);
  });
});
