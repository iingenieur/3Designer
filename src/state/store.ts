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
/** 클라이언트가 마지막으로 보고한 워커 상태가 error인지. evaluate()가 busy→ready로 덮어쓰지 않게 한다. */
let kernelFailed = false;

export const useStore = create<State>((set, get) => {
  const kernel = new KernelClient((status, message) => {
    kernelFailed = status === "error";
    set({ kernelStatus: status, kernelError: message ?? null });
    if (status !== "ready") return;
    // 재시작에 성공했으면 마지막 평가가 메시를 못 만들었거나 커널 오류로 끝난 모델을 다시 평가한다
    const { part, mesh, featureErrors } = get();
    if (part && (mesh === null || featureErrors.some((e) => e.featureId === "*"))) void evaluate(part);
  });

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

  const SAVE_DEBOUNCE_MS = 300;
  let saveTimer: ReturnType<typeof setTimeout> | null = null;

  if (import.meta.hot) {
    import.meta.hot.dispose(() => {
      if (saveTimer) clearTimeout(saveTimer);
      kernel.terminate();
      connection.close();
    });
  }

  /**
   * 현재 오류를 서버에 보내 `<파일>.errors.json`에 기록하게 한다. 둘 다 빈 배열이면 성공.
   * 스키마 오류가 있으면 화면의 featureErrors는 이전 성공 모델의 것이므로 파일에는 빈 배열로 쓴다 (상태는 표시용으로 유지).
   */
  function reportErrors() {
    const { schemaErrors, featureErrors } = get();
    const features = schemaErrors.length > 0 ? [] : featureErrors;
    connection.send({ kind: "errors", errors: { schema: schemaErrors, features } });
  }

  async function evaluate(part: Part) {
    const seq = ++evaluationSeq;
    const { resolved, errors: exprErrors } = resolvePart(part);
    // 워커가 죽은(또는 포기한) 상태면 busy로 바꾸지 않는다. 요청은 재시작을 기다리거나 즉시 거부된다.
    if (!kernelFailed) set({ kernelStatus: "busy" });
    try {
      const { mesh, errors: kernelErrors } = await kernel.evaluate(resolved);
      if (seq !== evaluationSeq) return; // 더 새로운 평가가 있으면 버린다
      set({ mesh, featureErrors: [...exprErrors, ...kernelErrors], kernelStatus: kernelFailed ? "error" : "ready" });
      reportErrors();
    } catch (e) {
      if (seq !== evaluationSeq) return;
      set({
        featureErrors: [...exprErrors, { featureId: "*", stage: "kernel", message: e instanceof Error ? e.message : String(e) }],
        // 클라이언트가 워커 오류를 보고한 상태면 그대로 둔다
        kernelStatus: kernelFailed ? "error" : "ready",
      });
      reportErrors();
    }
  }

  /**
   * UI 편집을 적용한다: 즉시 재평가하고, 300ms 디바운스로 서버에 저장한다.
   *
   * 저장 정책: 항상 "UI가 지금 보여주는 모델"을 저장한다. 타이머는 편집 시점의 값이 아니라
   * 발화 시점의 get().part를 보내고, 그 사이 외부 파일 수정(file 메시지)이 도착하면
   * loadJson이 타이머를 취소한다. 즉 외부 수정이 먼저 화면에 반영되면 그쪽이 이기고,
   * 디스크와 화면이 어긋나는 일은 없다.
   *
   * 저장 형식: compactPart로 기본값을 빼고 키 순서를 정리한 뒤 보낸다. 서버는 2칸 들여쓰기로
   * 다시 쓰므로 예제처럼 피처 한 줄짜리 레이아웃은 저장 후 바뀐다 (값은 그대로).
   */
  function applyEdit(next: Part) {
    set({ part: next });
    void evaluate(next);
    scheduleSave();
  }

  function scheduleSave() {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      saveTimer = null;
      const part = get().part;
      if (part) connection.send({ kind: "save", part: edit.compactPart(part) });
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
      // 외부 파일이 도착했으니 화면이 그것을 보여준다. 예약된 저장은 옛 편집이므로 취소한다 (저장 정책은 applyEdit 참고)
      if (saveTimer) {
        clearTimeout(saveTimer);
        saveTimer = null;
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
        const { data, errors } = await kernel.exportSTL(resolved);
        // 피처 오류가 있어도 나머지로 만든 형상을 내려받게 하되, 경고는 남긴다
        set({ exportError: errors.length > 0 ? `피처 오류가 있는 상태로 내보냈습니다 (${errors.length}개)` : null });
        return data;
      } catch (e) {
        set({ exportError: e instanceof Error ? e.message : String(e) });
        return null;
      }
    },
  };
});
