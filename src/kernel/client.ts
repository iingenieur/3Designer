import type { ResolvedPart, FeatureError } from "../model/resolve";
import type { MeshData, WorkerRequest, WorkerResponse } from "./protocol";

export type KernelStatus = "loading" | "ready" | "error";
export type StatusListener = (status: KernelStatus, message?: string) => void;

/** 실제 Worker 중 클라이언트가 쓰는 부분. 테스트에서 가짜 워커를 꽂을 수 있게 분리했다. */
export interface WorkerLike {
  postMessage(message: WorkerRequest, transfer?: Transferable[]): void;
  terminate(): void;
  onmessage: ((e: MessageEvent<WorkerResponse>) => void) | null;
  onerror: ((e: ErrorEvent) => void) | null;
}

export interface KernelClientOptions {
  createWorker?: () => WorkerLike;
  /** 워커가 죽었을 때 다시 띄우는 최대 횟수. 핸드셰이크에 성공하면 카운터를 되돌린다. */
  maxRespawns?: number;
  /** 재시작 대기 시간. 실제 대기는 backoffMs × 시도 횟수. */
  backoffMs?: number;
}

type Pending = { resolve: (r: WorkerResponse) => void; reject: (e: Error) => void };

const CANNOT_START = "커널을 시작할 수 없습니다";

function createRealWorker(): WorkerLike {
  return new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
}

/**
 * 커널 워커와 통신하는 클라이언트. 요청마다 id를 붙여 응답을 매칭한다.
 * 워커가 죽거나(onerror, fatal 실패, 초기화 실패) 하면 백오프를 두고 다시 만들고 대기 중인 요청은 실패시킨다.
 * 재시작 횟수가 상한을 넘으면 포기하고 이후 모든 요청을 즉시 거부한다.
 */
export class KernelClient {
  private worker: WorkerLike | null = null;
  private nextId = 1;
  private pending = new Map<number, Pending>();
  private readyPromise: Promise<void> = Promise.resolve();
  private readyResolve: () => void = () => {};
  private readyReject: (e: Error) => void = () => {};
  /** 재시작 대기 중에 들어온 요청이 새 워커를 기다리는 데 쓴다. */
  private spawned: Promise<void> = Promise.resolve();
  private spawnedResolve: () => void = () => {};
  private respawnTimer: ReturnType<typeof setTimeout> | null = null;
  private respawnAttempts = 0;
  /** 상한 초과 또는 terminate()로 더 이상 워커를 만들지 않는 상태 */
  private closed: string | null = null;

  private readonly onStatus?: StatusListener;
  private readonly createWorker: () => WorkerLike;
  private readonly maxRespawns: number;
  private readonly backoffMs: number;

  constructor(onStatus?: StatusListener, options: KernelClientOptions = {}) {
    this.onStatus = onStatus;
    this.createWorker = options.createWorker ?? createRealWorker;
    this.maxRespawns = options.maxRespawns ?? 3;
    this.backoffMs = options.backoffMs ?? 500;
    this.spawn();
  }

  private spawn() {
    this.readyPromise = new Promise<void>((resolve, reject) => {
      this.readyResolve = resolve;
      this.readyReject = reject;
    });
    this.readyPromise.catch(() => {}); // ready()를 아무도 안 기다릴 때 unhandled rejection 방지
    this.onStatus?.("loading");

    let worker: WorkerLike;
    try {
      worker = this.createWorker();
    } catch (e) {
      this.handleCrash(null, `커널 워커를 만들 수 없습니다: ${e instanceof Error ? e.message : String(e)}`);
      return;
    }
    this.worker = worker;
    worker.onmessage = (e) => this.handleMessage(worker, e.data);
    worker.onerror = (e) => this.handleCrash(worker, `커널 워커 오류: ${e.message}`);
    this.spawnedResolve();
  }

  private handleMessage(worker: WorkerLike, message: WorkerResponse) {
    if (worker !== this.worker) return; // 종료된 워커의 늦은 메시지
    switch (message.kind) {
      case "ready":
        this.respawnAttempts = 0;
        this.onStatus?.("ready");
        this.readyResolve();
        return;
      case "initFailed":
        this.handleCrash(worker, message.message);
        return;
      case "failed":
        if (message.fatal) {
          this.handleCrash(worker, message.message);
          return;
        }
        break;
    }
    const p = this.pending.get(message.requestId);
    if (!p) return;
    this.pending.delete(message.requestId);
    p.resolve(message);
  }

  private rejectPending(error: Error) {
    for (const p of this.pending.values()) p.reject(error);
    this.pending.clear();
  }

  /** 워커가 못 쓰게 됐다. 대기 중인 요청을 실패시키고 상한 안에서 다시 띄운다. */
  private handleCrash(worker: WorkerLike | null, message: string) {
    if (worker !== this.worker) return;
    // 이전 재시작을 기다리던 send()를 깨운다. 워커가 아직 없으면 send()가 다음 spawned를 다시 기다린다.
    this.spawnedResolve();
    this.rejectPending(new Error(`${message}. 워커를 다시 시작합니다.`));
    worker?.terminate();
    this.worker = null;
    this.readyReject(new Error(message));
    if (this.closed) return;

    this.respawnAttempts += 1;
    if (this.respawnAttempts > this.maxRespawns) {
      this.closed = `${CANNOT_START}: ${message}`;
      this.onStatus?.("error", this.closed);
      return;
    }
    this.onStatus?.("error", message);
    this.spawned = new Promise<void>((resolve) => {
      this.spawnedResolve = resolve;
    });
    this.respawnTimer = setTimeout(() => {
      this.respawnTimer = null;
      this.spawn();
    }, this.backoffMs * this.respawnAttempts);
  }

  /** 현재 워커의 핸드셰이크 약속. 재시작되면 새 워커의 것으로 바뀐다. */
  ready(): Promise<void> {
    return this.readyPromise;
  }

  /** 워커를 끄고 대기 중인 요청을 실패시킨다. 이후 요청은 모두 거부된다 (HMR 정리용). */
  terminate() {
    this.closed = "커널 클라이언트가 종료되었습니다";
    if (this.respawnTimer) {
      clearTimeout(this.respawnTimer);
      this.respawnTimer = null;
    }
    this.rejectPending(new Error(this.closed));
    this.worker?.terminate();
    this.worker = null;
    this.readyReject(new Error(this.closed));
    this.spawnedResolve();
  }

  private async send(request: WorkerRequest): Promise<WorkerResponse> {
    // 재시작 대기 중이면 새 워커를 기다린다. 깨어났는데 워커가 없으면(재시작 시도 실패) 다음 재시작을 기다린다.
    while (!this.worker && !this.closed) await this.spawned;
    if (this.closed) throw new Error(this.closed);
    const worker = this.worker;
    if (!worker) throw new Error(CANNOT_START);
    return new Promise((resolve, reject) => {
      this.pending.set(request.requestId, { resolve, reject });
      try {
        worker.postMessage(request);
      } catch (e) {
        this.pending.delete(request.requestId);
        reject(new Error(`커널 요청 전송 실패: ${e instanceof Error ? e.message : String(e)}`));
      }
    });
  }

  async evaluate(part: ResolvedPart): Promise<{ mesh: MeshData | null; errors: FeatureError[] }> {
    const res = await this.send({ kind: "evaluate", requestId: this.nextId++, part });
    if (res.kind === "failed") throw new Error(res.message);
    if (res.kind !== "evaluated") throw new Error("예상치 못한 워커 응답");
    return { mesh: res.mesh, errors: res.errors };
  }

  async exportSTL(part: ResolvedPart): Promise<{ data: ArrayBuffer | null; errors: FeatureError[] }> {
    const res = await this.send({ kind: "exportSTL", requestId: this.nextId++, part });
    if (res.kind === "failed") throw new Error(res.message);
    if (res.kind !== "stl") throw new Error("예상치 못한 워커 응답");
    return { data: res.data, errors: res.errors };
  }
}
