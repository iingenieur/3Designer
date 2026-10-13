import type { ResolvedPart, FeatureError } from "../model/resolve";

export interface MeshData {
  positions: Float32Array;
  normals: Float32Array;
  indices: Uint32Array;
  /** 선분 좌표 (x,y,z 쌍의 연속) */
  edges: Float32Array;
  bounds: [[number, number, number], [number, number, number]];
  volume: number;
}

export type WorkerRequest =
  | { kind: "evaluate"; requestId: number; part: ResolvedPart }
  | { kind: "exportSTL"; requestId: number; part: ResolvedPart };

export type WorkerResponse =
  | { kind: "ready" }
  /** 커널(WASM) 초기화 자체가 실패했다. 이 워커는 어떤 요청도 처리할 수 없다. */
  | { kind: "initFailed"; message: string }
  | { kind: "evaluated"; requestId: number; mesh: MeshData | null; errors: FeatureError[] }
  | { kind: "stl"; requestId: number; data: ArrayBuffer | null; errors: FeatureError[] }
  /** 요청 처리 실패. fatal이면 WASM 런타임이 망가진 것이라 워커를 다시 띄워야 한다. */
  | { kind: "failed"; requestId: number; message: string; fatal: boolean };
