import type { Part, Feature } from "./schema";

/**
 * 피처 한 개에 덮어쓸 필드. Partial은 판별 유니온에 분배되므로
 * 어느 한 변종의 부분 집합이면 된다. 피처 종류(type) 변경은 지원하지 않는다.
 */
export type FeaturePatch = Partial<Feature>;

/** 파라미터 값을 바꾼 새 Part를 돌려준다. 입력은 바꾸지 않는다. */
export function setParameter(part: Part, name: string, value: number): Part {
  return { ...part, parameters: { ...part.parameters, [name]: value } };
}

/** id가 일치하는 피처에 patch를 얕게 병합한다. */
export function updateFeature(part: Part, id: string, patch: FeaturePatch): Part {
  return {
    ...part,
    features: part.features.map((f) => (f.id === id ? ({ ...f, ...patch } as Feature) : f)),
  };
}

/** 피처를 toIndex 위치로 옮긴다. 범위를 벗어나면 끝으로 붙인다. 없는 id면 입력 그대로. */
export function moveFeature(part: Part, id: string, toIndex: number): Part {
  const features = [...part.features];
  const from = features.findIndex((f) => f.id === id);
  if (from < 0) return part;
  const [item] = features.splice(from, 1);
  const to = Math.max(0, Math.min(toIndex, features.length));
  features.splice(to, 0, item);
  return { ...part, features };
}

export function deleteFeature(part: Part, id: string): Part {
  return { ...part, features: part.features.filter((f) => f.id !== id) };
}

export function toggleSuppressed(part: Part, id: string): Part {
  return {
    ...part,
    features: part.features.map((f) => (f.id === id ? { ...f, suppressed: !f.suppressed } : f)),
  };
}

/** 파일에 쓰지 않는 스키마 기본값. 파싱된 Part에는 항상 채워져 있으므로 저장 시 걸러낸다. */
const FEATURE_DEFAULTS: Record<string, unknown> = {
  suppressed: false,
  op: "add",
  plane: "XY",
  offset: 0,
  depth: "through",
  edges: "all",
};
const PATTERN_DEFAULTS: Record<string, unknown> = { direction: "X", startAngle: 0 };

function withoutDefaults(obj: Record<string, unknown>, defaults: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(obj).filter(([k, v]) => !(k in defaults && defaults[k] === v)));
}

function isPattern(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && "pattern" in v;
}

/**
 * 저장용 평범한 객체로 바꾼다. 파싱(Zod)은 기본값을 채우고 키를 스키마 순서로 재배열하므로
 * 그대로 쓰면 사람이 쓴 파일이 부풀고 뒤섞인다. 최상위는 version·units·parameters·features 순,
 * 피처는 id·type·name이 먼저 오고 나머지는 그대로이며, 기본값과 같은 필드는 뺀다.
 * 기본값을 생략한 파일이면 JSON 값 기준으로 손실 없이 되돌아온다.
 */
export function compactPart(part: Part): unknown {
  return {
    version: part.version,
    units: part.units,
    parameters: part.parameters,
    features: part.features.map((f) => {
      const { id, type, name, ...rest } = f;
      const out: Record<string, unknown> = name === undefined ? { id, type } : { id, type, name };
      Object.assign(out, withoutDefaults(rest, FEATURE_DEFAULTS));
      if (isPattern(out.pattern)) out.pattern = withoutDefaults(out.pattern, PATTERN_DEFAULTS);
      if (isPattern(out.positions)) out.positions = withoutDefaults(out.positions, PATTERN_DEFAULTS);
      return out;
    }),
  };
}
