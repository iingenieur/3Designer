import type { Part, Feature } from "./schema";
import { evaluate, ExpressionError } from "./expression";

/** 수식이 아니라 그대로 두어야 하는 문자열 필드 */
// schema.ts에 문자열 enum 필드를 추가하면 여기에도 반드시 추가한다. 빠지면 그 값이 수식으로 평가되어 모든 피처가 실패한다.
const ENUM_KEYS = new Set(["id", "name", "type", "op", "edges", "plane", "kind", "pattern", "direction", "units"]);

export interface FeatureError {
  featureId: string;
  /** 어느 단계에서 실패했는지 */
  stage: "expression" | "kernel";
  message: string;
}

/** 모든 수식이 숫자로 바뀐 피처. 타입 수준에서는 Feature와 같은 모양이지만 string 숫자 필드가 없다. */
export type ResolvedFeature = Feature;

export interface ResolvedPart {
  parameters: Record<string, number>;
  features: ResolvedFeature[];
}

function resolveValue(value: unknown, key: string, vars: Record<string, number>): unknown {
  if (typeof value === "string") {
    if (ENUM_KEYS.has(key)) return value;
    if (key === "depth" && value === "through") return value;
    return evaluate(value, vars);
  }
  if (Array.isArray(value)) return value.map((v, i) => resolveValue(v, String(i), vars));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = resolveValue(v, k, vars);
    return out;
  }
  return value;
}

export function resolvePart(part: Part): { resolved: ResolvedPart; errors: FeatureError[] } {
  const errors: FeatureError[] = [];
  const features: ResolvedFeature[] = [];
  for (const feature of part.features) {
    if (feature.suppressed) continue;
    try {
      features.push(resolveValue(feature, "", part.parameters) as ResolvedFeature);
    } catch (e) {
      const message = e instanceof ExpressionError ? `${e.message} (수식: "${e.expression}")` : String(e);
      errors.push({ featureId: feature.id, stage: "expression", message });
    }
  }
  return { resolved: { parameters: part.parameters, features }, errors };
}
