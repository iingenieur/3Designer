/** 서버 → 클라이언트(뷰어 또는 에이전트) */
export type ServerMessage =
  | { kind: "file"; path: string; text: string }
  | { kind: "fileError"; message: string }
  /** 감시 중인 파일과 같은 폴더의 모델 목록(`*.3d.json` 이름). 연결 직후와 폴더 내용이 바뀔 때 보낸다. */
  | { kind: "files"; dir: string; files: string[] }
  /** 뷰어에게: 지금 화면을 캡처해 달라. text는 캡처 전에 뷰어가 반영해야 할 파일 내용(없으면 즉시 캡처). */
  | { kind: "screenshotRequest"; id: number; text?: string }
  /** 에이전트에게: 요청 결과 */
  | { kind: "screenshot"; id: number; dataUrl: string }
  | { kind: "screenshotFailed"; id: number; message: string };

/**
 * 클라이언트 → 서버
 * - hello: 연결 직후 역할을 알린다. viewer만 스크린샷 요청을 받는다. 연결당 한 번, 역할 전환 없음.
 * - save: UI에서 편집한 모델 전체. 서버가 파일에 다시 쓴다.
 * - errors: 뷰어가 마지막 로드/평가에서 얻은 오류. 서버가 `<파일>.errors.json`에 기록한다.
 *   페이로드 모양은 `{ schema: SchemaError[], features: FeatureError[] }`이며 둘 다 빈 배열이면 성공.
 * - open: 뷰어가 같은 폴더의 다른 모델로 감시 대상을 바꾼다. file은 `files` 목록에 있던 이름. 서버가 모두에게 새 `file`을 보낸다.
 * - screenshotRequest: 에이전트. id는 에이전트가 정한 값이고 응답에 그대로 돌아온다.
 * - screenshot / screenshotFailed: 뷰어가 screenshotRequest에 답한다. id는 서버가 준 값.
 */
export type ClientMessage =
  | { kind: "hello"; role: "viewer" | "agent" }
  | { kind: "save"; part: unknown }
  | { kind: "errors"; errors: unknown }
  | { kind: "open"; file: string }
  | { kind: "screenshotRequest"; id: number; text?: string }
  | { kind: "screenshot"; id: number; dataUrl: string }
  | { kind: "screenshotFailed"; id: number; message: string };
