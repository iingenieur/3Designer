import {
  drawCircle,
  drawPolysides,
  drawRectangle,
  drawRoundedRectangle,
  makeBaseBox,
  makeCylinder,
  makeSphere,
  type Drawing,
  type EdgeFinder,
  type Shape3D,
  type Sketch,
} from "replicad";
import type { ResolvedPart, ResolvedFeature, FeatureError } from "../model/resolve";
import { errorMessage, isFatalKernelError } from "./errors";

export interface EvaluateResult {
  /** 최종 바디. 바디를 만드는 피처가 하나도 없으면 null. */
  shape: Shape3D | null;
  errors: FeatureError[];
}

type Vec3 = [number, number, number];

function applyTransform(shape: Shape3D, transform: ResolvedFeature["transform"]): Shape3D {
  if (!transform) return shape;
  let out = shape;
  const [rx, ry, rz] = (transform.rotation ?? [0, 0, 0]) as Vec3;
  if (rx) out = out.rotate(rx, [0, 0, 0], [1, 0, 0]);
  if (ry) out = out.rotate(ry, [0, 0, 0], [0, 1, 0]);
  if (rz) out = out.rotate(rz, [0, 0, 0], [0, 0, 1]);
  if (transform.position) out = out.translate(transform.position as Vec3);
  return out;
}

type ExtrudeProfile = Extract<ResolvedFeature, { type: "extrude" }>["profile"];

/** 2D 프로파일을 원점 중심의 Drawing으로 만든다. polygon의 radius는 외접원 반지름이다. */
function makeProfile(profile: ExtrudeProfile): Drawing {
  switch (profile.kind) {
    case "rect": {
      const w = profile.width as number;
      const h = profile.height as number;
      const r = profile.cornerRadius as number | undefined;
      return r ? drawRoundedRectangle(w, h, r) : drawRectangle(w, h);
    }
    case "circle":
      return drawCircle(profile.radius as number);
    case "polygon":
      return drawPolysides(profile.radius as number, profile.sides as number);
  }
}

/** 바디를 만드는 피처 하나를 독립된 솔리드로 만든다. */
function makeBody(feature: ResolvedFeature): Shape3D | null {
  switch (feature.type) {
    case "box": {
      const [x, y, z] = feature.size as Vec3;
      return makeBaseBox(x, y, z);
    }
    case "cylinder":
      return makeCylinder(feature.radius as number, feature.height as number);
    case "sphere":
      return makeSphere(feature.radius as number);
    case "extrude": {
      const sketch = makeProfile(feature.profile).sketchOnPlane(feature.plane, feature.offset as number) as Sketch;
      return sketch.extrude(feature.height as number);
    }
    default:
      return null;
  }
}

type PatternSpec = NonNullable<Extract<ResolvedFeature, { type: "box" }>["pattern"]>;

const AXIS: Record<"X" | "Y" | "Z", Vec3> = { X: [1, 0, 0], Y: [0, 1, 0], Z: [0, 0, 1] };

/** 패턴 사양을 오프셋 목록으로 푼다. 패턴이 없으면 원점 하나. */
export function patternOffsets(pattern: PatternSpec | undefined): Vec3[] {
  if (!pattern) return [[0, 0, 0]];
  const count = pattern.count as number;
  if (!Number.isInteger(count) || count < 1) throw new Error(`패턴 count는 1 이상의 정수여야 합니다 (현재: ${count})`);
  if (pattern.pattern === "linear") {
    const spacing = pattern.spacing as number;
    const [ax, ay, az] = AXIS[pattern.direction];
    return Array.from({ length: count }, (_, i) => [ax * spacing * i, ay * spacing * i, az * spacing * i]);
  }
  const r = (pattern.diameter as number) / 2;
  const start = ((pattern.startAngle as number) * Math.PI) / 180;
  return Array.from({ length: count }, (_, i) => {
    const a = start + (2 * Math.PI * i) / count;
    return [r * Math.cos(a), r * Math.sin(a), 0];
  });
}

/** 바디 하나를 패턴대로 복제해 하나로 합친다. translate는 원본을 소멸시키므로 매번 clone한다. 패턴이 없으면 그대로 돌려준다. */
function applyPattern(body: Shape3D, pattern: PatternSpec | undefined): Shape3D {
  if (!pattern) return body;
  const [first, ...rest] = patternOffsets(pattern);
  let out = body.clone().translate(first);
  for (const offset of rest) out = out.fuse(body.clone().translate(offset));
  return out;
}

function combine(current: Shape3D | null, body: Shape3D, op: "add" | "cut" | "intersect", featureId: string): Shape3D {
  if (current === null) {
    if (op === "add") return body;
    throw new Error(`"${op}" 연산을 적용할 바디가 아직 없습니다 (피처 "${featureId}" 앞에 바디가 필요합니다)`);
  }
  switch (op) {
    case "add":
      return current.fuse(body);
    case "cut":
      return current.cut(body);
    case "intersect":
      return current.intersect(body);
  }
}

type HoleFeature = Extract<ResolvedFeature, { type: "hole" }>;

function holePositions(positions: HoleFeature["positions"]): [number, number][] {
  if (Array.isArray(positions)) return positions as [number, number][];
  return patternOffsets(positions).map(([x, y]) => [x, y]);
}

/**
 * 현재 바디의 윗면(바운딩 박스 최대 Z)에서 아래로 구멍을 뚫는다. through면 양쪽 1mm 여유를 두고 관통한다.
 * 막힌 구멍도 공구를 윗면 위로 1mm 더 뻗어 윗면과 공구 윗면이 겹치는(coplanar) 불리언을 피한다.
 * transform은 position만 모든 구멍 위치의 오프셋(x, y, z)으로 쓰고 rotation은 무시한다.
 */
function applyHole(current: Shape3D | null, feature: HoleFeature): Shape3D {
  if (!current) throw new Error(`구멍을 뚫을 바디가 없습니다 (피처 "${feature.id}" 앞에 바디가 필요합니다)`);
  const [[, , zMin], [, , zMax]] = current.boundingBox.bounds;
  const through = feature.depth === "through";
  const depth = through ? zMax - zMin + 2 : (feature.depth as number);
  const toolHeight = through ? depth : depth + 1;
  const z0 = through ? zMin - 1 : zMax - depth;
  const radius = (feature.diameter as number) / 2;
  const [px, py, pz] = (feature.transform?.position ?? [0, 0, 0]) as Vec3;
  let out = current;
  for (const [x, y] of holePositions(feature.positions)) {
    out = out.cut(makeCylinder(radius, toolHeight, [x + px, y + py, z0 + pz]));
  }
  return out;
}

type EdgeFeature = Extract<ResolvedFeature, { type: "fillet" } | { type: "chamfer" }>;
type EdgeSelector = EdgeFeature["edges"];

/** 모서리 선택자를 replicad EdgeFinder 필터로 바꾼다. "all"이면 필터 없음. */
function edgeFilter(shape: Shape3D, selector: EdgeSelector): ((e: EdgeFinder) => EdgeFinder) | undefined {
  const [[, , zMin], [, , zMax]] = shape.boundingBox.bounds;
  switch (selector) {
    case "all":
      return undefined;
    case "top":
      return (e) => e.inPlane("XY", zMax);
    case "bottom":
      return (e) => e.inPlane("XY", zMin);
    case "vertical":
      return (e) => e.inDirection("Z");
  }
}

function applyEdgeFeature(current: Shape3D | null, feature: EdgeFeature): Shape3D {
  if (!current) throw new Error(`모서리를 가공할 바디가 없습니다 (피처 "${feature.id}" 앞에 바디가 필요합니다)`);
  const filter = edgeFilter(current, feature.edges);
  if (feature.type === "fillet") return current.fillet(feature.radius as number, filter);
  return current.chamfer(feature.distance as number, filter);
}

/** 피처 하나를 현재 바디에 적용해 새 바디를 돌려준다. 바디를 만들지 않는 피처면 현재 바디를 그대로 돌려준다. */
export function evaluateFeature(current: Shape3D | null, feature: ResolvedFeature): Shape3D | null {
  if (feature.type === "hole") return applyHole(current, feature);
  if (feature.type === "fillet" || feature.type === "chamfer") return applyEdgeFeature(current, feature);
  const body = makeBody(feature);
  if (body === null) return current;
  const op = "op" in feature ? feature.op : "add";
  const pattern = "pattern" in feature ? feature.pattern : undefined;
  const patterned = applyPattern(body, pattern);
  return combine(current, applyTransform(patterned, feature.transform), op, feature.id);
}

/**
 * 피처를 순서대로 평가해 하나의 바디를 만든다. 실패한 피처는 건너뛰고 오류를 모은다.
 * WASM 런타임이 망가진 치명적 오류는 피처 오류로 삼키지 않고 밖으로 던져 워커가 재시작되게 한다.
 * `step`은 테스트에서 피처 평가를 바꿔 끼우는 용도다.
 */
export function evaluateFeatures(part: ResolvedPart, step: typeof evaluateFeature = evaluateFeature): EvaluateResult {
  let current: Shape3D | null = null;
  const errors: FeatureError[] = [];

  for (const feature of part.features) {
    try {
      current = step(current, feature);
    } catch (e) {
      if (isFatalKernelError(e)) throw e;
      errors.push({ featureId: feature.id, stage: "kernel", message: errorMessage(e) });
    }
  }

  return { shape: current, errors };
}
