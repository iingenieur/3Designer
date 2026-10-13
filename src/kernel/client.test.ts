import { describe, it, expect, vi } from "vitest";
import { KernelClient, type KernelStatus, type WorkerLike } from "./client";
import type { WorkerRequest, WorkerResponse } from "./protocol";
import type { ResolvedPart } from "../model/resolve";

const part = { version: 1, units: "mm", parameters: {}, features: [] } as unknown as ResolvedPart;

class FakeWorker implements WorkerLike {
  onmessage: ((e: MessageEvent<WorkerResponse>) => void) | null = null;
  onerror: ((e: ErrorEvent) => void) | null = null;
  posted: WorkerRequest[] = [];
  terminated = false;
  throwOnPost = false;

  postMessage(message: WorkerRequest) {
    if (this.throwOnPost) throw new Error("DataCloneError");
    this.posted.push(message);
  }
  terminate() {
    this.terminated = true;
  }
  emit(message: WorkerResponse) {
    this.onmessage?.({ data: message } as MessageEvent<WorkerResponse>);
  }
  crash(message: string) {
    this.onerror?.({ message } as ErrorEvent);
  }
  /** 마지막으로 받은 요청 id */
  get lastId() {
    return this.posted[this.posted.length - 1].requestId;
  }
}

function setup(options: { maxRespawns?: number } = {}) {
  const workers: FakeWorker[] = [];
  const statuses: [KernelStatus, string | undefined][] = [];
  const client = new KernelClient((s, m) => statuses.push([s, m]), {
    createWorker: () => {
      const w = new FakeWorker();
      workers.push(w);
      return w;
    },
    backoffMs: 1,
    ...options,
  });
  return { client, workers, statuses, current: () => workers[workers.length - 1] };
}

const tick = () => new Promise((r) => setTimeout(r, 5));

describe("KernelClient: handshake", () => {
  it("reports loading on spawn and ready on handshake", async () => {
    const { client, workers, statuses } = setup();
    expect(workers).toHaveLength(1);
    expect(statuses).toEqual([["loading", undefined]]);
    workers[0].emit({ kind: "ready" });
    await client.ready();
    expect(statuses).toEqual([["loading", undefined], ["ready", undefined]]);
  });

  it("resolves evaluate with the matching response", async () => {
    const { client, workers } = setup();
    const w = workers[0];
    w.emit({ kind: "ready" });
    const promise = client.evaluate(part);
    expect(w.posted[0]).toMatchObject({ kind: "evaluate", part });
    w.emit({ kind: "evaluated", requestId: w.lastId, mesh: null, errors: [] });
    await expect(promise).resolves.toEqual({ mesh: null, errors: [] });
  });

  it("rejects evaluate on a non-fatal failure without restarting the worker", async () => {
    const { client, workers } = setup();
    const w = workers[0];
    const promise = client.evaluate(part);
    w.emit({ kind: "failed", requestId: w.lastId, message: "커널 오류 StdFail_NotDone: BRep_API", fatal: false });
    await expect(promise).rejects.toThrow("StdFail_NotDone");
    expect(w.terminated).toBe(false);
    expect(workers).toHaveLength(1);
  });
});

describe("KernelClient: crash and respawn", () => {
  it("terminates and respawns on a fatal failure, rejecting pending requests", async () => {
    const { client, workers, statuses, current } = setup();
    const w = workers[0];
    w.emit({ kind: "ready" });
    const promise = client.evaluate(part);
    w.emit({ kind: "failed", requestId: w.lastId, message: "Aborted(OOM)", fatal: true });
    await expect(promise).rejects.toThrow("Aborted(OOM)");
    expect(w.terminated).toBe(true);
    await tick();
    expect(workers).toHaveLength(2);
    expect(statuses.map(([s]) => s)).toEqual(["loading", "ready", "error", "loading"]);
    expect(statuses[2][1]).toContain("Aborted(OOM)");
    current().emit({ kind: "ready" });
    await client.ready();
    expect(statuses.at(-1)).toEqual(["ready", undefined]);
  });

  it("respawns on worker onerror", async () => {
    const { client, workers } = setup();
    const promise = client.evaluate(part);
    workers[0].crash("script error");
    await expect(promise).rejects.toThrow("script error");
    await tick();
    expect(workers).toHaveLength(2);
  });

  it("respawns after initFailed and reports the message", async () => {
    const { workers, statuses } = setup();
    workers[0].emit({ kind: "initFailed", message: "wasm 로드 실패" });
    expect(workers[0].terminated).toBe(true);
    await tick();
    expect(workers).toHaveLength(2);
    expect(statuses[1]).toEqual(["error", "wasm 로드 실패"]);
  });

  it("ready() follows the current worker after a respawn", async () => {
    const { client, workers, current } = setup();
    workers[0].crash("x");
    await tick();
    let resolved = false;
    const ready = client.ready().then(() => (resolved = true));
    await tick();
    expect(resolved).toBe(false);
    current().emit({ kind: "ready" });
    await ready;
    expect(resolved).toBe(true);
  });

  it("gives up after the respawn cap and rejects further sends immediately", async () => {
    const { client, workers, statuses, current } = setup({ maxRespawns: 3 });
    for (let i = 0; i < 4; i++) {
      current().crash(`crash ${i}`);
      await tick();
    }
    expect(workers).toHaveLength(4); // 최초 1 + 재시작 3
    expect(statuses.at(-1)?.[0]).toBe("error");
    expect(statuses.at(-1)?.[1]).toContain("커널을 시작할 수 없습니다");
    await expect(client.evaluate(part)).rejects.toThrow("커널을 시작할 수 없습니다");
    expect(workers).toHaveLength(4);
  });

  it("resets the respawn counter after a successful handshake", async () => {
    const { workers, current } = setup({ maxRespawns: 2 });
    for (let i = 0; i < 6; i++) {
      current().crash("flaky");
      await tick();
      current().emit({ kind: "ready" });
    }
    expect(workers).toHaveLength(7);
  });

  it("backs off 500ms × attempt by default", async () => {
    vi.useFakeTimers();
    try {
      const workers: FakeWorker[] = [];
      new KernelClient(undefined, {
        createWorker: () => {
          const w = new FakeWorker();
          workers.push(w);
          return w;
        },
      });
      workers[0].crash("a");
      await vi.advanceTimersByTimeAsync(499);
      expect(workers).toHaveLength(1);
      await vi.advanceTimersByTimeAsync(1);
      expect(workers).toHaveLength(2);
      workers[1].crash("b");
      await vi.advanceTimersByTimeAsync(999);
      expect(workers).toHaveLength(2);
      await vi.advanceTimersByTimeAsync(1);
      expect(workers).toHaveLength(3);
    } finally {
      vi.useRealTimers();
    }
  });

  it("waits for the respawned worker when a request arrives during backoff", async () => {
    const { client, workers, current } = setup();
    workers[0].crash("x");
    const promise = client.evaluate(part);
    await tick();
    expect(workers).toHaveLength(2);
    const w = current();
    expect(w.posted).toHaveLength(1);
    w.emit({ kind: "evaluated", requestId: w.lastId, mesh: null, errors: [] });
    await expect(promise).resolves.toEqual({ mesh: null, errors: [] });
  });
});

describe("KernelClient: send and terminate", () => {
  it("rejects when postMessage throws and leaves nothing pending", async () => {
    const { client, workers } = setup();
    workers[0].throwOnPost = true;
    await expect(client.evaluate(part)).rejects.toThrow("DataCloneError");
    workers[0].throwOnPost = false;
    const promise = client.exportSTL(part);
    const w = workers[0];
    w.emit({ kind: "stl", requestId: w.lastId, data: null, errors: [] });
    await expect(promise).resolves.toEqual({ data: null, errors: [] });
  });

  it("terminate() kills the worker, rejects pending and refuses new requests", async () => {
    const { client, workers } = setup();
    const promise = client.evaluate(part);
    client.terminate();
    expect(workers[0].terminated).toBe(true);
    await expect(promise).rejects.toThrow();
    await expect(client.evaluate(part)).rejects.toThrow();
    await tick();
    expect(workers).toHaveLength(1); // terminate 후에는 재시작하지 않는다
  });
});
