import { create } from "zustand";
import { PartSchema, type Part } from "../model/schema";
import * as edit from "../model/edit";
import { resolvePart, type FeatureError } from "../model/resolve";
import { KernelClient } from "../kernel/client";
import type { MeshData } from "../kernel/protocol";
import { Connection, type ConnectionStatus } from "./connection";

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
  /** 파일 서버(ws://…:5174)와의 연결 상태 */
  connection: ConnectionStatus;
  /** 서버가 감시 중인 모델 파일의 절대 경로. 아직 받지 못했으면 null. */
  filePath: string | null;
  /** 피처 트리에서 선택된 피처. 없으면 null. */
  selectedFeatureId: string | null;
  /** 파일 내용(JSON 문자열)을 받아 검증·평가한다. */
  loadJson: (text: string) => void;
  select: (id: string | null) => void;
  setParameter: (name: string, value: number) => void;
  updateFeature: (id: string, patch: edit.FeaturePatch) => void;
  moveFeature: (id: string, toIndex: number) => void;
  deleteFeature: (id: string) => void;
  toggleSuppressed: (id: string) => void;
  /** STL 바이너리를 돌려준다. 실패하면 exportError를 채우고 null. */
  exportSTL: () => Promise<ArrayBuffer | null>;
}

let evaluationSeq = 0;

export const useStore = create<State>((set, get) => {
  const kernel = new KernelClient((status, message) => set({ kernelStatus: status, kernelError: message ?? null }));

  const connection = new Connection(
    (m) => {
      if (m.kind === "file") {
        set({ filePath: m.path });
        get().loadJson(m.text);
      } else {
        set({ schemaErrors: [{ path: "", message: m.message }] });
        reportErrors();
      }
    },
    (status) => set({ connection: status }),
  );

  if (import.meta.hot) {
    import.meta.hot.dispose(() => {
      kernel.terminate();
      connection.close();
    });
  }

  /** 현재 오류를 서버에 보내 `<파일>.errors.json`에 기록하게 한다. 둘 다 빈 배열이면 성공. */
  function reportErrors() {
    const { schemaErrors, featureErrors } = get();
    connection.send({ kind: "errors", errors: { schema: schemaErrors, features: featureErrors } });
  }

  async function evaluate(part: Part) {
    const seq = ++evaluationSeq;
    const { resolved, errors: exprErrors } = resolvePart(part);
    set({ kernelStatus: "busy" });
    try {
      const { mesh, errors: kernelErrors } = await kernel.evaluate(resolved);
      if (seq !== evaluationSeq) return; // 더 새로운 평가가 있으면 버린다
      set({ mesh, featureErrors: [...exprErrors, ...kernelErrors], kernelStatus: "ready" });
      reportErrors();
    } catch (e) {
      if (seq !== evaluationSeq) return;
      set({
        featureErrors: [...exprErrors, { featureId: "*", stage: "kernel", message: e instanceof Error ? e.message : String(e) }],
        // 클라이언트가 워커 오류를 보고한 상태면 그대로 둔다
        ...(get().kernelStatus !== "error" ? { kernelStatus: "ready" as const } : {}),
      });
      reportErrors();
    }
  }

  const SAVE_DEBOUNCE_MS = 300;
  let saveTimer: ReturnType<typeof setTimeout> | null = null;

  /**
   * UI 편집을 적용한다: 즉시 재평가하고, 300ms 디바운스로 서버에 저장한다.
   *
   * 경쟁 조건: 편집 직후 서버에서 외부 수정(file 메시지)이 도착하면 loadJson이 part를
   * 덮어쓰지만, 예약된 저장은 취소하지 않는다. 사용자의 편집이 파일에 기록되어 이기는 쪽이
   * 된다(마지막 쓰기 우선). 외부 편집과 UI 편집이 수백 ms 안에 겹치는 경우에 한한다.
   */
  function applyEdit(next: Part) {
    set({ part: next });
    void evaluate(next);
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      saveTimer = null;
      connection.send({ kind: "save", part: next });
    }, SAVE_DEBOUNCE_MS);
  }

  /** 현재 part에 순수 편집 함수를 적용한다. 모델이 없으면 아무것도 하지 않는다. */
  function editPart(fn: (part: Part) => Part) {
    const part = get().part;
    if (!part) return;
    const next = fn(part);
    if (next !== part) applyEdit(next);
  }

  return {
    part: null,
    mesh: null,
    featureErrors: [],
    schemaErrors: [],
    kernelStatus: "loading",
    kernelError: null,
    exportError: null,
    connection: "connecting",
    filePath: null,
    selectedFeatureId: null,

    loadJson(text) {
      let raw: unknown;
      try {
        raw = JSON.parse(text);
      } catch (e) {
        set({ schemaErrors: [{ path: "", message: `JSON 문법 오류: ${String(e)}` }] });
        reportErrors();
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
        reportErrors();
        return; // 마지막 성공 모델(part, mesh)은 유지한다
      }
      // 외부에서 파일이 바뀌어도 같은 id가 남아 있으면 선택을 유지한다
      const selected = get().selectedFeatureId;
      const stillExists = selected !== null && result.data.features.some((f) => f.id === selected);
      set({ part: result.data, schemaErrors: [], selectedFeatureId: stillExists ? selected : null });
      void evaluate(result.data);
    },

    select(id) {
      set({ selectedFeatureId: id });
    },
    setParameter(name, value) {
      editPart((part) => edit.setParameter(part, name, value));
    },
    updateFeature(id, patch) {
      editPart((part) => edit.updateFeature(part, id, patch));
    },
    moveFeature(id, toIndex) {
      editPart((part) => edit.moveFeature(part, id, toIndex));
    },
    deleteFeature(id) {
      editPart((part) => edit.deleteFeature(part, id));
      if (get().selectedFeatureId === id) set({ selectedFeatureId: null });
    },
    toggleSuppressed(id) {
      editPart((part) => edit.toggleSuppressed(part, id));
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
