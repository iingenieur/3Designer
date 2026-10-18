// 궤 부품들을 조립 위치에 놓고 (1) 부품 쌍별 간섭 부피 검사 (2) 뷰어용 조립 미리보기 ark-assembly.3d.json 생성
// 사용법(저장소 루트): node --import tsx examples/ark/assemble.mts
import { readFileSync, writeFileSync } from "node:fs";
import { measureVolume, type Shape3D } from "replicad";
import { parsePart } from "../../server/validate";
import { resolvePart } from "../../src/model/resolve";
import { evaluateFeatures } from "../../src/kernel/evaluate";
import { initKernelForNode } from "../../src/kernel/node";

const DIR = new URL(".", import.meta.url).pathname;
type V3 = [number, number, number];
const load = (f: string) => { const { part } = parsePart(readFileSync(DIR + f, "utf8")); return part!; };
const body = load("ark-body.3d.json"), lid = load("ark-lid.3d.json"), cher = load("ark-cherub.3d.json"),
  ring = load("ark-ring.3d.json"), pole = load("ark-pole.3d.json"),
  tablet = load("ark-tablet.3d.json"), jar = load("ark-manna-jar.3d.json"), jarLid = load("ark-manna-lid.3d.json"),
  rod = load("ark-aaron-rod.3d.json");
const B = body.parameters, Ld = lid.parameters, C = cher.parameters, R = ring.parameters, P = pole.parameters;
const c30 = Math.cos(Math.PI / 6);

// 배치 계산 (부품 좌표 → 조립 좌표)
const lidTop = B.H + Ld.T;                       // 덮개 판이 본체 윗면(H)에 얹힘, 뒤집혀서 립이 아래
const slotY = B.W / 2 + B.plinthT - B.dvR * c30;  // 슬롯 육각 중심 y
const slotX = B.L / 2 - B.ringInset;
const ringCY = R.dvR * c30 + 0.3 + R.padT + R.ringOD / 2 - 1.5, ringCZ = R.ringOD / 2 - R.flat;
const pegX = Ld.L / 2 - Ld.pegInset;
const inX = B.L / 2 - B.wall, inY = B.W / 2 - B.wall; // 내부 반폭
type Place = { tag: string; label: string; part: any; rot: V3; pos: V3; dz?: number; dx?: number; inner?: number };
const places: Place[] = [
  { tag: "body", label: "본체", part: body, rot: [0, 0, 0], pos: [0, 0, 0], dz: 30 },
  // 내부 보물: 배치 가이드 (왼쪽 돌판 2장, 오른쪽 위 항아리, 앞쪽 대각선 지팡이). 본체와 함께 움직이고 explodeInner로 위로 빠진다
  { tag: "tab1", label: "십계명 돌판 1", part: tablet, rot: [0, 0, 0], pos: [-(inX - 2 - tablet.parameters.TW / 2), inY - 2 - tablet.parameters.TH / 2, B.floorT], dz: 30, inner: 130 },
  { tag: "tab2", label: "십계명 돌판 2", part: tablet, rot: [0, 0, 0], pos: [-(inX - 2 - tablet.parameters.TW / 2) + tablet.parameters.TW + 2, inY - 2 - tablet.parameters.TH / 2, B.floorT], dz: 30, inner: 130 },
  { tag: "jar", label: "만나 항아리", part: jar, rot: [0, 0, 0], pos: [inX - 3 - (jar.parameters.handleX + jar.parameters.handleR), inY - 3 - jar.parameters.bodyR, B.floorT], dz: 30, inner: 130 },
  { tag: "jarLid", label: "항아리 뚜껑", part: jarLid, rot: [180, 0, 0], pos: [inX - 3 - (jar.parameters.handleX + jar.parameters.handleR), inY - 3 - jar.parameters.bodyR, B.floorT + jar.parameters.topZ + jarLid.parameters.capT], dz: 30, inner: 150 },
  { tag: "rod", label: "아론의 지팡이", part: rod, rot: [0, 0, 6], pos: [0, -32, B.floorT], dz: 30, inner: 130 },
  { tag: "lid", label: "덮개", part: lid, rot: [180, 0, 0], pos: [0, 0, lidTop], dz: 130 },
  { tag: "chA", label: "천사상 왼쪽", part: cher, rot: [0, 0, 0], pos: [-pegX, 0, lidTop - C.pinH], dz: 160 },
  { tag: "chB", label: "천사상 오른쪽", part: cher, rot: [0, 0, 180], pos: [pegX, 0, lidTop - C.pinH], dz: 160 },
  { tag: "rBR", label: "고리 뒤-오른쪽", part: ring, rot: [0, 0, 0], pos: [slotX, slotY, 0] },
  { tag: "rBL", label: "고리 뒤-왼쪽", part: ring, rot: [0, 0, 0], pos: [-slotX, slotY, 0] },
  { tag: "rFR", label: "고리 앞-오른쪽", part: ring, rot: [0, 0, 180], pos: [slotX, -slotY, 0] },
  { tag: "rFL", label: "고리 앞-왼쪽", part: ring, rot: [0, 0, 180], pos: [-slotX, -slotY, 0] },
  { tag: "pB", label: "봉 뒤", part: pole, rot: [0, 0, 0], pos: [0, slotY + ringCY, ringCZ - (P.D / 2 - P.flat)], dx: 150 },
  { tag: "pF", label: "봉 앞", part: pole, rot: [0, 0, 0], pos: [0, -(slotY + ringCY), ringCZ - (P.D / 2 - P.flat)], dx: -150 },
];

await initKernelForNode();
const shapes = new Map<string, Shape3D>();
for (const p of places) {
  const { shape } = evaluateFeatures(resolvePart(p.part).resolved);
  let s = shape!.clone();
  const [rx, ry, rz] = p.rot;
  if (rx) s = s.rotate(rx, [0, 0, 0], [1, 0, 0]);
  if (ry) s = s.rotate(ry, [0, 0, 0], [0, 1, 0]);
  if (rz) s = s.rotate(rz, [0, 0, 0], [0, 0, 1]);
  shapes.set(p.tag, s.translate(p.pos));
}
const pairs: [string, string][] = [["body", "lid"], ["lid", "chA"], ["lid", "chB"],
  ["body", "rBR"], ["body", "rBL"], ["body", "rFR"], ["body", "rFL"],
  ["rBR", "pB"], ["rBL", "pB"], ["rFR", "pF"], ["rFL", "pF"], ["body", "pB"], ["body", "pF"], ["chA", "chB"],
  ["body", "tab1"], ["body", "tab2"], ["tab1", "tab2"], ["body", "jar"], ["tab2", "jar"], ["jar", "jarLid"], ["body", "jarLid"],
  ["body", "rod"], ["tab1", "rod"], ["tab2", "rod"], ["jar", "rod"], ["lid", "jar"], ["lid", "jarLid"]];
const label = (t: string) => places.find((p) => p.tag === t)!.label;
console.log("== 간섭 부피 (0이어야 정상) ==");
for (const [a, b] of pairs) {
  let v = 0;
  try { v = measureVolume(shapes.get(a)!.clone().intersect(shapes.get(b)!.clone())); } catch { v = 0; }
  console.log(`${label(a)} ∩ ${label(b)}: ${v.toFixed(2)} mm³`);
}
let all = shapes.get("body")!.clone();
for (const p of places.slice(1)) all = all.fuse(shapes.get(p.tag)!.clone());
const bb = all.boundingBox.bounds;
console.log("조립 외곽:", bb.map((v) => v.map((x) => x.toFixed(1)).join(", ")).join("  →  "));

// 뷰어용 조립 미리보기: 피처를 숫자로 풀고 배치 회전을 합성
const rad = Math.PI / 180;
const rotM = ([rx, ry, rz]: V3) => {
  const [cx, sx, cy, sy, cz, sz] = [Math.cos(rx * rad), Math.sin(rx * rad), Math.cos(ry * rad), Math.sin(ry * rad), Math.cos(rz * rad), Math.sin(rz * rad)];
  const Rx = [[1, 0, 0], [0, cx, -sx], [0, sx, cx]], Ry = [[cy, 0, sy], [0, 1, 0], [-sy, 0, cy]], Rz = [[cz, -sz, 0], [sz, cz, 0], [0, 0, 1]];
  const mul = (a: number[][], b: number[][]) => a.map((r, i) => b[0].map((_, j) => r.reduce((s, _, k) => s + a[i][k] * b[k][j], 0)));
  return mul(Rz, mul(Ry, Rx));
};
const mulMV = (m: number[][], v: number[]) => m.map((r) => r[0] * v[0] + r[1] * v[1] + r[2] * v[2]);
const euler = (m: number[][]): V3 => {
  const ry = -Math.asin(Math.max(-1, Math.min(1, m[2][0])));
  let rx: number, rz: number;
  if (Math.abs(m[2][0]) < 0.999999) { rx = Math.atan2(m[2][1], m[2][2]); rz = Math.atan2(m[1][0], m[0][0]); }
  else { rx = Math.atan2(-m[1][2], m[1][1]); rz = 0; }
  const r = (x: number) => Math.round((x / rad) * 1e4) / 1e4 + 0;
  return [r(rx), r(ry), r(rz)];
};
const round = (x: number) => Math.round(x * 1e4) / 1e4 + 0;
const features: any[] = [];
for (const p of places) {
  const Rp = rotM(p.rot);
  for (const f of resolvePart(p.part).resolved.features as any[]) {
    if (f.id === "floor" && p.part !== ring) continue; // 출력용 바닥 평탄화 cut은 다른 부품을 깎으므로 제외
    if (f.type === "chamfer" || f.type === "fillet" || f.type === "hole") continue; // 바디 전체 기준 수정 피처는 조립에서 의미가 달라짐
    const tf = f.transform ?? {};
    const Rt = rotM((tf.rotation ?? [0, 0, 0]) as V3);
    const num = mulMV(Rp, (tf.position ?? [0, 0, 0]) as number[]).map((x, i) => round(x + p.pos[i]));
    const pos: (number | string)[] = [...num];
    if (p.dx) pos[0] = `${num[0]} + ${p.dx}*explodeX`;
    if (p.dz) pos[2] = `${num[2]} + ${p.dz}*explodeZ` + (p.inner ? ` + ${p.inner}*explodeInner` : "");
    const Rm = Rp.map((r, i) => Rt[0].map((_, j) => r.reduce((s, _, k) => s + Rp[i][k] * Rt[k][j], 0)));
    features.push({ ...f, id: `${p.tag}_${f.id}`, name: `[${p.label}] ${f.name ?? f.id}`, transform: { rotation: euler(Rm), position: pos } });
  }
}
writeFileSync(DIR + "ark-assembly.3d.json", JSON.stringify({ version: 1, units: "mm", parameters: { explodeZ: 0, explodeX: 0, explodeInner: 0 }, features }, null, 1) + "\n");
console.log("미리보기 피처", features.length, "개 → ark-assembly.3d.json");
