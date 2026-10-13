import { measureVolume } from "replicad";
import { PartSchema, type Part } from "../src/model/schema";
import { resolvePart, type FeatureError } from "../src/model/resolve";
import { evaluateFeatures } from "../src/kernel/evaluate";
import { initKernelForNode } from "../src/kernel/node";

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

/** 스키마 → 수식 → 커널 순으로 검증하고 형상을 잰다. 커널은 첫 호출 때 초기화된다. */
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
    const [min, max] = shape.boundingBox.bounds;
    const bounds: Measurements["bounds"] = [
      [round(min[0]), round(min[1]), round(min[2])],
      [round(max[0]), round(max[1]), round(max[2])],
    ];
    measurements = {
      bounds,
      size: [round(max[0] - min[0]), round(max[1] - min[1]), round(max[2] - min[2])],
      volume: round(measureVolume(shape)),
    };
    if (bounds[0][2] < -1e-6) {
      warnings.push(`바닥이 Z=0 아래로 내려갑니다 (최저 Z = ${bounds[0][2]}). 베드에 놓이도록 올리세요.`);
    }
  } else if (features.length === 0) {
    warnings.push("형상이 비어 있습니다 (모든 피처가 꺼져 있거나 컷만 있음).");
  }
  return { ok: features.length === 0 && shape !== null, schema: [], features, measurements, warnings };
}
