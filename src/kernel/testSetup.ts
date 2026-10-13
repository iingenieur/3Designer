import { createRequire } from "node:module";
import { initKernel } from "./oc";

const require = createRequire(import.meta.url);

/** Node 테스트에서 replicad를 초기화한다. */
export function initKernelForNode(): Promise<void> {
  return initKernel(require.resolve("replicad-opencascadejs/wasm"));
}
