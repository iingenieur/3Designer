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
  kernelStatus: "loading" | "ready" | "busy";
  /** 파일 내용(JSON 문자열)을 받아 검증·평가한다. */
  loadJson: (text: string) => void;
  exportSTL: () => Promise<ArrayBuffer | null>;
}

const kernel = new KernelClient();
let evaluationSeq = 0;

export const useStore = create<State>((set, get) => {
  kernel.ready().then(() => set({ kernelStatus: "ready" }));

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
        featureErrors: [...exprErrors, { featureId: "*", stage: "kernel", message: String(e) }],
        kernelStatus: "ready",
      });
    }
  }

  return {
    part: null,
    mesh: null,
    featureErrors: [],
    schemaErrors: [],
    kernelStatus: "loading",

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
      const { resolved } = resolvePart(part);
      const { data } = await kernel.exportSTL(resolved);
      return data;
    },
  };
});
