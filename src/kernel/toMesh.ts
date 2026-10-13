import { measureVolume, type Shape3D } from "replicad";
import type { MeshData } from "./protocol";

const MESH_OPTIONS = { tolerance: 0.05, angularTolerance: 0.3 };

export function shapeToMesh(shape: Shape3D): MeshData {
  const mesh = shape.mesh(MESH_OPTIONS);
  const edges = shape.meshEdges(MESH_OPTIONS);
  return {
    positions: new Float32Array(mesh.vertices),
    normals: new Float32Array(mesh.normals),
    indices: new Uint32Array(mesh.triangles),
    edges: new Float32Array(edges.lines),
    bounds: shape.boundingBox.bounds,
    volume: measureVolume(shape),
  };
}

export async function shapeToSTL(shape: Shape3D): Promise<ArrayBuffer> {
  const blob = shape.blobSTL({ ...MESH_OPTIONS, binary: true });
  return blob.arrayBuffer();
}
