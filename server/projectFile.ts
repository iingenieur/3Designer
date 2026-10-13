import { readFileSync } from "node:fs";
import { writeFileAtomic } from "./atomicWrite";

/**
 * 프로젝트 파일 하나의 읽기/쓰기. 자기가 쓴 내용은 기억해 감시 이벤트에서 되돌아오는 변경을 걸러낸다.
 * 쓰기는 원자적이라(임시 파일 + rename) MCP 서버의 쓰기와 교차해도 파일이 깨지지 않는다.
 */
export class ProjectFile {
  private lastWritten: string | null = null;

  constructor(public readonly path: string) {}

  /** `flange.3d.json` → `flange.3d.errors.json` */
  get errorsPath(): string {
    return this.path.replace(/\.json$/, ".errors.json");
  }

  read(): string {
    return readFileSync(this.path, "utf8");
  }

  /** 내용이 실제로 바뀌었을 때만 쓰고 true를 돌려준다. */
  write(value: unknown): boolean {
    const text = JSON.stringify(value, null, 2) + "\n";
    const current = this.safeRead();
    if (current === text) return false;
    writeFileAtomic(this.path, text);
    this.lastWritten = text;
    return true;
  }

  writeErrors(errors: unknown): void {
    writeFileAtomic(this.errorsPath, JSON.stringify(errors, null, 2) + "\n");
  }

  /** 디스크의 현재 내용이 마지막으로 자기가 쓴 것과 같은가 (UI 편집이 감시 이벤트로 되돌아온 경우) */
  isOwnContent(text: string): boolean {
    return this.lastWritten === text;
  }

  private safeRead(): string | null {
    try {
      return this.read();
    } catch {
      return null;
    }
  }
}
