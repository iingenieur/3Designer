import opencascade from "replicad-opencascadejs";
import { setOC } from "replicad";

let ready: Promise<void> | null = null;

/**
 * replicad(OpenCascade WASM)를 한 번만 초기화한다.
 * 브라우저 워커에서는 `import wasmUrl from "replicad-opencascadejs/wasm?url"` 값을,
 * Node에서는 require.resolve 경로를 넘긴다.
 */
export function initKernel(wasmUrl: string): Promise<void> {
  if (!ready) {
    ready = opencascade({ locateFile: () => wasmUrl }).then((OC) => {
      setOC(OC);
    });
  }
  return ready;
}
