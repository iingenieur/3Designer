import { measureVolume } from "replicad";
import { PartSchema, type Part } from "../src/model/schema";
import { resolvePart, type FeatureError } from "../src/model/resolve";
import { evaluateFeatures } from "../src/kernel/evaluate";
import { initKernelForNode } from "../src/kernel/node";
import { errorMessage, isFatalKernelError } from "../src/kernel/errors";

/** `src/state/store.ts`의 loadJson이 만드는 스키마 오류와 같은 모양 */
export interface SchemaError {
  path: string;
  message: string;
}

export interface Measurements {
  bounds: [[number, number, number], [number, number, number]];
  /** bounds의 가로·세로·높이 */
  size: [number, number, number];
  /** mm³ */
  volume: number;
}

/** 모델 하나의 검증 결과. `schema`·`features`는 `<파일>.errors.json`과 같은 모양이다. */
export interface ValidationResult {
  /** 오류가 하나도 없고 형상이 있다 */
  ok: boolean;
  schema: SchemaError[];
  features: FeatureError[];
  /** 형상이 있을 때만. 피처 오류가 있어도 나머지로 만든 형상을 잰다. */
  measurements: Measurements | null;
  /** 3D 프린팅 적합성 경고 */
  warnings: string[];
}

/** JSON 텍스트 또는 객체를 Part로 파싱한다. 실패하면 part는 null, schema에 이유. */
export function parsePart(raw: unknown): { part: Part | null; schema: SchemaError[] } {
  let value = raw;
  if (typeof raw === "string") {
    try {
      value = JSON.parse(raw);
    } catch (e) {
      return { part: null, schema: [{ path: "", message: `JSON 문법 오류: ${String(e)}` }] };
    }
  }
  const result = PartSchema.safeParse(value);
  if (!result.success) {
    return {
      part: null,
      schema: result.error.issues.map((i) => ({ path: i.path.map(String).join("."), message: i.message })),
    };
  }
  return { part: result.data, schema: [] };
}

/** 부동소수 오차를 숨기기 위해 소수 셋째 자리로 반올림한다 */
const round = (v: number) => Math.round(v * 1000) / 1000;

/**
 * 스키마 → 수식 → 커널 순으로 검증하고 형상을 잰다. 커널은 첫 호출 때 초기화된다.
 * 치명적 커널 오류(WASM 런타임 손상)는 features로 감싸지 않고 던진다 (evaluateFeatures 참조).
 * 호출자가 프로세스 재시작을 결정한다.
 */
export async function validatePart(raw: unknown): Promise<ValidationResult> {
  const { part, schema } = parsePart(raw);
  if (!part) return { ok: false, schema, features: [], measurements: null, warnings: [] };
  const warnings: string[] = [];
  if (part.features.length === 0) {
    warnings.push("피처가 없어 형상이 비어 있습니다.");
    return { ok: false, schema: [], features: [], measurements: null, warnings };
  }
  await initKernelForNode();
  const { resolved, errors: exprErrors } = resolvePart(part);
  const { shape, errors: kernelErrors } = evaluateFeatures(resolved);
  const features = [...exprErrors, ...kernelErrors];
  let measurements: Measurements | null = null;
  if (shape) {
    try {
      // 컷이 바디를 전부 제거하거나 겹치지 않는 교집합이면 오류 없이 빈 Shape3D가 온다.
      // 빈 형상의 boundingBox는 "Bnd_Box is void"를 던지므로 부피(0)로 먼저 걸러낸다.
      const volume = round(measureVolume(shape));
      if (volume <= 0) {
        warnings.push("형상이 비어 있습니다 (컷이 바디를 모두 제거했거나 겹치지 않는 교집합).");
      } else {
        const [min, max] = shape.boundingBox.bounds;
        const bounds: Measurements["bounds"] = [
          [round(min[0]), round(min[1]), round(min[2])],
          [round(max[0]), round(max[1]), round(max[2])],
        ];
        measurements = {
          bounds,
          size: [round(max[0] - min[0]), round(max[1] - min[1]), round(max[2] - min[2])],
          volume,
        };
        // 소수 셋째 자리 반올림이 OCC 공차(1e-7)로 생기는 음수를 걸러주는 공차 역할을 한다
        if (bounds[0][2] < 0) {
          warnings.push(`바닥이 Z=0 아래로 내려갑니다 (최저 Z = ${bounds[0][2]}). 베드에 놓이도록 올리세요.`);
        }
      }
    } catch (e) {
      if (isFatalKernelError(e)) throw e;
      features.push({ featureId: "*", stage: "kernel", message: errorMessage(e) });
    } finally {
      // 장기 실행 MCP 프로세스에서 WASM 힙이 새지 않도록 측정이 끝난 형상은 해제한다
      shape.delete();
    }
  } else if (features.length === 0) {
    warnings.push("형상이 비어 있습니다 (모든 피처가 꺼져 있음).");
  }
  return { ok: features.length === 0 && measurements !== null, schema: [], features, measurements, warnings };
}
