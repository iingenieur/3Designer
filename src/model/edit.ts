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
