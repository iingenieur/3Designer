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
  | { kind: "evaluated"; requestId: number; mesh: MeshData | null; errors: FeatureError[] }
  | { kind: "stl"; requestId: number; data: ArrayBuffer | null; errors: FeatureError[] }
  | { kind: "failed"; requestId: number; message: string };
