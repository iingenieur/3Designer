import type { ServerMessage } from "./protocol";

/** 클라이언트 하나에 메시지를 보내는 함수. 연결마다 하나씩 만들어 그 연결의 신원으로 쓴다. */
export type Send = (message: ServerMessage) => void;

interface Pending {
  requester: Send;
  requesterId: number;
  /** 이 요청을 받은 뷰어들. 모두 끊기면 요청은 실패한다. */
  viewers: Set<Send>;
  timer: ReturnType<typeof setTimeout>;
}

/**
 * 에이전트의 스크린샷 요청을 뷰어(브라우저)에 넘기고 답을 되돌린다.
 * 서버 내부 id로 요청을 추적하고, 에이전트에게는 에이전트가 준 id로 답한다.
 * 뷰어가 여럿이면 모두에게 보내고 첫 답을 쓴다. 뷰어가 없으면 즉시 실패.
 */
export class ScreenshotRelay {
  private viewers = new Set<Send>();
  private pending = new Map<number, Pending>();
  private seq = 0;

  constructor(private readonly timeoutMs = 10_000) {}

  addViewer(send: Send) {
    this.viewers.add(send);
  }

  /** 뷰어든 에이전트든 연결이 끊겼을 때 */
  removeClient(send: Send) {
    this.viewers.delete(send);
    for (const [id, p] of [...this.pending]) {
      if (p.requester === send) {
        this.drop(id);
      } else if (p.viewers.has(send)) {
        p.viewers.delete(send);
        if (p.viewers.size === 0) this.fail(id, "브라우저 연결이 끊겼습니다.");
      }
    }
  }

  request(requester: Send, requesterId: number, text?: string) {
    if (this.viewers.size === 0) {
      requester({
        kind: "screenshotFailed",
        id: requesterId,
        message: "브라우저(뷰어)가 연결되어 있지 않습니다. http://localhost:5173 을 여세요.",
      });
      return;
    }
    const id = ++this.seq;
    const timer = setTimeout(() => this.fail(id, `뷰어가 ${this.timeoutMs / 1000}초 안에 응답하지 않았습니다.`), this.timeoutMs);
    this.pending.set(id, { requester, requesterId, viewers: new Set(this.viewers), timer });
    for (const v of this.viewers) v({ kind: "screenshotRequest", id, text });
  }

  /** 뷰어가 캡처에 성공했다. 모르는(이미 끝난) id이거나 그 요청을 받지 않은 클라이언트의 답이면 무시. */
  resolve(from: Send, id: number, dataUrl: string) {
    if (!this.isResponder(from, id)) return;
    const p = this.drop(id);
    if (p) p.requester({ kind: "screenshot", id: p.requesterId, dataUrl });
  }

  /** 뷰어가 캡처에 실패했다. 모르는(이미 끝난) id이거나 그 요청을 받지 않은 클라이언트의 답이면 무시. */
  reject(from: Send, id: number, message: string) {
    if (!this.isResponder(from, id)) return;
    this.fail(id, message);
  }

  /** from이 id 요청을 받은 뷰어인가 */
  private isResponder(from: Send, id: number): boolean {
    return this.pending.get(id)?.viewers.has(from) ?? false;
  }

  private fail(id: number, message: string) {
    const p = this.drop(id);
    if (p) p.requester({ kind: "screenshotFailed", id: p.requesterId, message });
  }

  private drop(id: number): Pending | undefined {
    const p = this.pending.get(id);
    if (!p) return undefined;
    clearTimeout(p.timer);
    this.pending.delete(id);
    return p;
  }
}
