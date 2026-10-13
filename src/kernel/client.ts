import type { ResolvedPart, FeatureError } from "../model/resolve";
import type { MeshData, WorkerRequest, WorkerResponse } from "./protocol";

type Pending = { resolve: (r: WorkerResponse) => void; reject: (e: Error) => void };

/**
 * 커널 워커와 통신하는 클라이언트. 요청마다 id를 붙여 응답을 매칭한다.
 * 워커가 죽으면 자동으로 다시 만들고 대기 중인 요청은 실패시킨다.
 */
export class KernelClient {
  private worker!: Worker;
  private nextId = 1;
  private pending = new Map<number, Pending>();
  private readyPromise!: Promise<void>;

  constructor() {
    this.spawn();
  }

  private spawn() {
    this.worker = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
    this.readyPromise = new Promise((resolve) => {
      const onReady = (e: MessageEvent<WorkerResponse>) => {
        if (e.data.kind === "ready") {
          this.worker.removeEventListener("message", onReady);
          resolve();
        }
      };
      this.worker.addEventListener("message", onReady);
    });
    this.worker.onmessage = (e: MessageEvent<WorkerResponse>) => {
      if (e.data.kind === "ready") return;
      const p = this.pending.get(e.data.requestId);
      if (!p) return;
      this.pending.delete(e.data.requestId);
      p.resolve(e.data);
    };
    this.worker.onerror = (e) => {
      const error = new Error(`커널 워커 오류: ${e.message}. 워커를 다시 시작합니다.`);
      for (const p of this.pending.values()) p.reject(error);
      this.pending.clear();
      this.worker.terminate();
      this.spawn();
    };
  }

  ready(): Promise<void> {
    return this.readyPromise;
  }

  private send(request: WorkerRequest): Promise<WorkerResponse> {
    return new Promise((resolve, reject) => {
      this.pending.set(request.requestId, { resolve, reject });
      this.worker.postMessage(request);
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
