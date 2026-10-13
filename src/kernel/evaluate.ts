import {
  drawCircle,
  drawPolysides,
  drawRectangle,
  drawRoundedRectangle,
  makeBaseBox,
  makeCylinder,
  makeSphere,
  type Drawing,
  type Shape3D,
  type Sketch,
} from "replicad";
import type { ResolvedPart, ResolvedFeature, FeatureError } from "../model/resolve";

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

/** 커널 예외는 WebAssembly.Exception일 수 있어 Error로 가정하지 않는다. */
function errorMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  return `커널 연산 실패: ${String(e)}`;
}

/** 피처를 순서대로 평가해 하나의 바디를 만든다. 실패한 피처는 건너뛰고 오류를 모은다. */
export function evaluateFeatures(part: ResolvedPart): EvaluateResult {
  let current: Shape3D | null = null;
  const errors: FeatureError[] = [];

  for (const feature of part.features) {
    try {
      const body = makeBody(feature);
      if (body === null) continue; // 바디가 아닌 피처는 다음 태스크에서 처리
      const op = "op" in feature ? feature.op : "add";
      current = combine(current, applyTransform(body, feature.transform), op, feature.id);
    } catch (e) {
      errors.push({ featureId: feature.id, stage: "kernel", message: errorMessage(e) });
    }
  }

  return { shape: current, errors };
}
