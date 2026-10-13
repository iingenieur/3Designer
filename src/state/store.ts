import { create } from "zustand";
import { PartSchema, type Part } from "../model/schema";
import { resolvePart, type FeatureError } from "../model/resolve";
import { KernelClient } from "../kernel/client";
import type { MeshData } from "../kernel/protocol";

export interface SchemaError {
  path: string;
  message: string;
}

interface State {
  part: Part | null;
  mesh: MeshData | null;
  featureErrors: FeatureError[];
  schemaErrors: SchemaError[];
  kernelStatus: "loading" | "ready" | "busy" | "error";
  /** 커널 워커 자체의 오류(초기화 실패, 재시작 포기). 상태가 error일 때만 의미 있다. */
  kernelError: string | null;
  /** 마지막 STL 내보내기 실패 메시지. 다음 내보내기에 성공하면 지워진다. */
  exportError: string | null;
  /** 파일 내용(JSON 문자열)을 받아 검증·평가한다. */
  loadJson: (text: string) => void;
  /** STL 바이너리를 돌려준다. 실패하면 exportError를 채우고 null. */
  exportSTL: () => Promise<ArrayBuffer | null>;
}

let evaluationSeq = 0;

export const useStore = create<State>((set, get) => {
  const kernel = new KernelClient((status, message) => set({ kernelStatus: status, kernelError: message ?? null }));

  if (import.meta.hot) import.meta.hot.dispose(() => kernel.terminate());

  async function evaluate(part: Part) {
    const seq = ++evaluationSeq;
    const { resolved, errors: exprErrors } = resolvePart(part);
    set({ kernelStatus: "busy" });
    try {
      const { mesh, errors: kernelErrors } = await kernel.evaluate(resolved);
      if (seq !== evaluationSeq) return; // 더 새로운 평가가 있으면 버린다
      set({ mesh, featureErrors: [...exprErrors, ...kernelErrors], kernelStatus: "ready" });
    } catch (e) {
      if (seq !== evaluationSeq) return;
      set({
        featureErrors: [...exprErrors, { featureId: "*", stage: "kernel", message: e instanceof Error ? e.message : String(e) }],
        // 클라이언트가 워커 오류를 보고한 상태면 그대로 둔다
        ...(get().kernelStatus !== "error" ? { kernelStatus: "ready" as const } : {}),
      });
    }
  }

  return {
    part: null,
    mesh: null,
    featureErrors: [],
    schemaErrors: [],
    kernelStatus: "loading",
    kernelError: null,
    exportError: null,

    loadJson(text) {
      let raw: unknown;
      try {
        raw = JSON.parse(text);
      } catch (e) {
        set({ schemaErrors: [{ path: "", message: `JSON 문법 오류: ${String(e)}` }] });
        return;
      }
      const result = PartSchema.safeParse(raw);
      if (!result.success) {
        set({
          schemaErrors: result.error.issues.map((i) => ({
            path: i.path.map(String).join("."),
            message: i.message,
          })),
        });
        return; // 마지막 성공 모델(part, mesh)은 유지한다
      }
      set({ part: result.data, schemaErrors: [] });
      void evaluate(result.data);
    },

    async exportSTL() {
      const part = get().part;
      if (!part) return null;
      try {
        const { resolved } = resolvePart(part);
        const { data } = await kernel.exportSTL(resolved);
        set({ exportError: null });
        return data;
      } catch (e) {
        set({ exportError: e instanceof Error ? e.message : String(e) });
        return null;
      }
    },
  };
});
