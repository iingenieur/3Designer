import { readdirSync, statSync } from "node:fs";
import { basename, join, resolve } from "node:path";

const MODEL_SUFFIX = ".3d.json";

/** 폴더 안의 모델 파일(`*.3d.json`) 이름을 정렬해 돌려준다. `*.errors.json`은 접미사가 달라 자연히 빠진다. 폴더가 없으면 []. */
export function listModels(dir: string): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return [];
  }
  return entries
    .filter((name) => name.endsWith(MODEL_SUFFIX))
    .filter((name) => {
      try {
        return statSync(join(dir, name)).isFile();
      } catch {
        return false;
      }
    })
    .sort();
}

/**
 * 뷰어가 고른 이름을 절대 경로로 바꾼다. 같은 폴더에 실제로 있는 모델 이름만 받는다 —
 * 경로 구분자가 섞인 이름(`../x`, `sub/x`)이나 목록에 없는 이름은 null.
 */
export function resolveModel(dir: string, name: string): string | null {
  if (!name || name !== basename(name)) return null;
  if (!listModels(dir).includes(name)) return null;
  return join(dir, name);
}

/** 명령행 인자가 모델 파일이면 그대로, 폴더면 그 안의 첫 모델. 없으면 null. */
export function pickInitialModel(arg: string): string | null {
  const path = resolve(arg);
  let st;
  try {
    st = statSync(path);
  } catch {
    return null;
  }
  if (st.isDirectory()) {
    const [first] = listModels(path);
    return first ? join(path, first) : null;
  }
  return st.isFile() ? path : null;
}
