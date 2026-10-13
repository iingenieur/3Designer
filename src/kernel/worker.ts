/// <reference lib="webworker" />
import wasmUrl from "replicad-opencascadejs/wasm?url";
import { initKernel } from "./oc";
import { evaluateFeatures } from "./evaluate";
import { shapeToMesh, shapeToSTL } from "./toMesh";
import { errorMessage, isFatalKernelError } from "./errors";
import type { WorkerRequest, WorkerResponse } from "./protocol";

const ready = initKernel(wasmUrl);

function post(message: WorkerResponse, transfer: Transferable[] = []) {
  self.postMessage(message, transfer);
}

self.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const request = event.data;
  try {
    await ready;
    const { shape, errors } = evaluateFeatures(request.part);
    if (request.kind === "evaluate") {
      const mesh = shape ? shapeToMesh(shape) : null;
      const transfer = mesh
        ? [mesh.positions.buffer, mesh.normals.buffer, mesh.indices.buffer, mesh.edges.buffer]
        : [];
      post({ kind: "evaluated", requestId: request.requestId, mesh, errors }, transfer);
    } else {
      const data = shape ? await shapeToSTL(shape) : null;
      post({ kind: "stl", requestId: request.requestId, data, errors }, data ? [data] : []);
    }
  } catch (e) {
    post({ kind: "failed", requestId: request.requestId, message: errorMessage(e), fatal: isFatalKernelError(e) });
  }
};

ready
  .then(() => post({ kind: "ready" }))
  .catch((e: unknown) => post({ kind: "initFailed", message: errorMessage(e) }));
