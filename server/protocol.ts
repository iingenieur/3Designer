/** 서버 → 브라우저 */
export type ServerMessage =
  | { kind: "file"; path: string; text: string }
  | { kind: "fileError"; message: string };

/**
 * 브라우저 → 서버
 * - save: UI에서 편집한 모델 전체. 서버가 파일에 다시 쓴다.
 * - errors: 뷰어가 마지막 로드/평가에서 얻은 오류. 서버가 `<파일>.errors.json`에 기록한다.
 *   페이로드 모양은 `{ schema: SchemaError[], features: FeatureError[] }`이며 둘 다 빈 배열이면 성공.
 */
export type ClientMessage =
  | { kind: "save"; part: unknown }
  | { kind: "errors"; errors: unknown };
