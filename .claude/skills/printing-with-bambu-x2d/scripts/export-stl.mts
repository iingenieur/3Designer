// 모델(*.3d.json)을 프로젝트 커널(replicad)로 평가해 바이너리 STL로 저장하고 메시를 검사한다.
// 사용법: node --import tsx .claude/skills/printing-with-bambu-x2d/scripts/export-stl.mts <모델.3d.json> <출력.stl>
import { readFileSync, writeFileSync } from "node:fs";
import { parsePart } from "../../../../server/validate";
import { resolvePart } from "../../../../src/model/resolve";
import { evaluateFeatures } from "../../../../src/kernel/evaluate";
import { initKernelForNode } from "../../../../src/kernel/node";
import { shapeToSTL } from "../../../../src/kernel/toMesh";

const [inPath, outPath] = process.argv.slice(2);
if (!inPath || !outPath) {
  console.error("사용법: export-stl.mts <모델.3d.json> <출력.stl>");
  process.exit(2);
}
const { part, schema } = parsePart(readFileSync(inPath, "utf8"));
if (!part) {
  console.error("스키마 오류:", JSON.stringify(schema));
  process.exit(1);
}
await initKernelForNode();
const { resolved, errors } = resolvePart(part);
const { shape, errors: kernelErrors } = evaluateFeatures(resolved);
if (errors.length || kernelErrors.length || !shape) {
  console.error("피처 오류:", JSON.stringify([...errors, ...kernelErrors]));
  process.exit(1);
}
const buf = Buffer.from(await shapeToSTL(shape));
writeFileSync(outPath, buf);

// 바이너리 STL 검사: 길이, 바운딩 박스, 모든 엣지가 정확히 두 삼각형에 속하는지(워터타이트)
const tri = buf.readUInt32LE(80);
const key = (o: number) => [0, 1, 2].map((c) => buf.readFloatLE(o + c * 4).toFixed(4)).join(",");
const edges = new Map<string, number>();
const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
for (let i = 0; i < tri; i++) {
  const o = 84 + i * 50 + 12;
  const v = [key(o), key(o + 12), key(o + 24)];
  for (let k = 0; k < 3; k++) {
    const a = v[k], b = v[(k + 1) % 3];
    const id = a < b ? `${a}|${b}` : `${b}|${a}`;
    edges.set(id, (edges.get(id) ?? 0) + 1);
    for (let c = 0; c < 3; c++) {
      const x = buf.readFloatLE(o + k * 12 + c * 4);
      min[c] = Math.min(min[c], x); max[c] = Math.max(max[c], x);
    }
  }
}
let nonManifold = 0;
for (const n of edges.values()) if (n !== 2) nonManifold++;
const r = (v: number) => Math.round(v * 1000) / 1000;
console.log(JSON.stringify({
  file: outPath, bytes: buf.length, bytesExpected: 84 + tri * 50, triangles: tri,
  min: min.map(r), max: max.map(r), nonManifoldEdges: nonManifold,
}));
if (buf.length !== 84 + tri * 50 || nonManifold > 0 || min[2] < -0.001) process.exit(1);
