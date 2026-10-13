import { writeFileSync, renameSync, rmSync } from "node:fs";
import { basename, dirname, join } from "node:path";

/**
 * 파일을 원자적으로 쓴다. 같은 디렉터리의 임시 파일(`.<이름>.tmp-<pid>`)에 쓴 뒤 rename하므로
 * 읽는 쪽(뷰어 감시, MCP 서버)이 반쯤 쓰인 파일을 보거나, 두 쓰기가 교차해 내용이 섞이는 일이 없다.
 * 실패하면 임시 파일을 치우고 다시 던진다. 임시 이름이 pid 기준이므로 같은 프로세스 안에서는 동기 쓰기만 전제한다.
 */
export function writeFileAtomic(path: string, text: string): void {
  const tmp = join(dirname(path), `.${basename(path)}.tmp-${process.pid}`);
  try {
    writeFileSync(tmp, text);
    renameSync(tmp, path);
  } catch (e) {
    rmSync(tmp, { force: true });
    throw e;
  }
}
