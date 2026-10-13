import { z } from "zod";

/** 숫자 또는 수식 문자열 ("D/2", "H - 2") */
export const Num = z.union([z.number(), z.string().min(1)]);
export type Num = z.infer<typeof Num>;

export const Vec3 = z.tuple([Num, Num, Num]);
export const Vec2 = z.tuple([Num, Num]);

export const Transform = z.object({
  position: Vec3.optional(),
  /** 도(deg) 단위, 원점 기준 X→Y→Z 순서 */
  rotation: Vec3.optional(),
});

export const PatternSpec = z.discriminatedUnion("pattern", [
  z.object({
    pattern: z.literal("linear"),
    count: Num,
    spacing: Num,
    direction: z.enum(["X", "Y", "Z"]).default("X"),
  }),
  z.object({
    pattern: z.literal("circular"),
    count: Num,
    /** 피치 원 지름 */
    diameter: Num,
    startAngle: Num.default(0),
  }),
]);

const BodyOp = z.enum(["add", "cut", "intersect"]).default("add");
const EdgeSelector = z.enum(["top", "bottom", "vertical", "all"]);
const PlaneName = z.enum(["XY", "XZ", "YZ"]).default("XY");

const Base = z.object({
  id: z.string().min(1),
  name: z.string().optional(),
  suppressed: z.boolean().default(false),
  transform: Transform.optional(),
});

const BodyBase = Base.extend({
  op: BodyOp,
  pattern: PatternSpec.optional(),
});

export const Profile = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("rect"), width: Num, height: Num, cornerRadius: Num.optional() }),
  z.object({ kind: z.literal("circle"), radius: Num }),
  z.object({ kind: z.literal("polygon"), sides: Num, radius: Num }),
]);

export const FeatureSchema = z.discriminatedUnion("type", [
  BodyBase.extend({ type: z.literal("box"), size: Vec3 }),
  BodyBase.extend({ type: z.literal("cylinder"), radius: Num, height: Num }),
  BodyBase.extend({ type: z.literal("sphere"), radius: Num }),
  BodyBase.extend({
    type: z.literal("extrude"),
    profile: Profile,
    plane: PlaneName,
    offset: Num.default(0),
    height: Num,
  }),
  Base.extend({
    type: z.literal("hole"),
    diameter: Num,
    depth: z.union([z.literal("through"), Num]).default("through"),
    positions: z.union([z.array(Vec2).min(1), PatternSpec]),
  }),
  Base.extend({ type: z.literal("fillet"), radius: Num, edges: EdgeSelector.default("all") }),
  Base.extend({ type: z.literal("chamfer"), distance: Num, edges: EdgeSelector.default("all") }),
]);

export const PartSchema = z
  .object({
    version: z.literal(1),
    units: z.literal("mm"),
    parameters: z.record(z.string(), z.number()).default({}),
    features: z.array(FeatureSchema),
  })
  .superRefine((part, ctx) => {
    const seen = new Set<string>();
    part.features.forEach((f, i) => {
      if (seen.has(f.id)) {
        ctx.addIssue({
          code: "custom",
          path: ["features", i, "id"],
          message: `피처 id 중복: "${f.id}"`,
        });
      }
      seen.add(f.id);
    });
  });

export type Part = z.infer<typeof PartSchema>;
export type Feature = Part["features"][number];
export type FeatureType = Feature["type"];
