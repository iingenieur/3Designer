# 3Designer

3D 프린팅용 AI 네이티브 파라메트릭 CAD. 사용자가 자연어로 요청하면 **Claude Code가 `*.3d.json` 피처 트리 파일을 편집**하고, 브라우저(`npm start -- <파일>`)가 즉시 다시 렌더링한다.

## MCP 도구 (있으면 파일 직접 편집보다 우선)

`.mcp.json`의 `3designer` 서버가 연결되어 있으면 `mcp__3designer__*` 도구가 보인다. 그때는 파일을 손으로 편집하지 말고 도구를 쓴다. 모든 도구가 검증 결과(`ok`, `schema`, `features`, `measurements`, `warnings`)를 바로 돌려주므로 errors.json을 기다릴 필요가 없다. 스키마 전문은 리소스 `doc://3designer/schema`(= `docs/schema.md`).

1. `get_model` — 편집 전에 항상 호출한다 (사용자가 UI에서 바꿨을 수 있다). 파일에 스키마 오류가 있으면 `model` 대신 `schema`와 `raw`가 온다.
2. 치수 변경은 `set_parameter`(변수가 없으면 새로 만든다, 숫자만). 피처 추가/수정/삭제는 `add_feature` / `update_feature` / `delete_feature`. `update_feature`는 `patch`를 얕게 병합하며 `type`은 바꿀 수 없다(삭제 후 추가). 큰 개편은 `validate`에 `model`을 넣어 파일을 건드리지 않고 먼저 시험한 뒤 `write_model`.
3. 편집 도구는 스키마 오류면 쓰지 않고(`written: false`) 거부한다. 수식·커널 오류는 파일에 쓰되 `features`로 알려 주니 읽고 고친다. `warnings`(바닥이 Z<0, 형상이 빔 등)는 사용자에게 알리거나 고친다. `measurements`(bounds·size·volume)로 크기·부피를 사용자에게 보고한다.
4. 형상이 의도대로인지 확실하지 않으면 `screenshot`으로 확인한다 (`npm start`로 띄운 서버와 열린 브라우저가 필요하다). 검증은 Node에서 직접 돌아 브라우저 없이도 된다.
5. `path`는 생략하면 `npm start`가 감시 중인 파일이다. 다른 파일을 다룰 때만 절대 경로로 준다.
6. 도구가 없으면(서버 미승인 등) 아래 파일 편집 규칙대로 한다.

## 모델 편집 규칙

- 스키마는 `docs/schema.md`. 새 피처 타입이나 필드를 지어내지 않는다.
- 치수는 가능한 한 `parameters`에 변수로 두고 피처에서 수식으로 참조한다. 사용자가 "지름을 50으로" 하면 변수 하나만 바꾸면 되도록.
- 피처 `name`은 한국어로, 사용자가 트리에서 알아볼 수 있게 쓴다. `id`는 짧은 영문.
- 편집 후 같은 폴더의 오류 파일(`flange.3d.json` → `flange.3d.errors.json`)을 읽어 오류가 있으면 고친다. `schema`와 `features`가 모두 빈 배열이면 성공.
- 3D 프린팅 기본 상식을 적용한다: 바닥(Z=0)은 평평하게, 벽 두께 1.2mm 이상, 볼트 구멍은 공칭 지름 + 0.3~0.4mm 여유(M3 → Ø3.4), 45°를 넘는 오버행은 사용자에게 알린다.
- 사용자가 스케치·돌출·필렛·보스·컷 같은 SolidWorks 용어를 쓰면 그대로 이해한다. 사용자는 SolidWorks 경험자다. "보스 돌출" = extrude op add, "컷 돌출" = extrude op cut.
- 파일을 편집하는 동안 사용자가 UI에서 치수를 바꿨을 수 있으니, 편집 전에 항상 파일을 다시 읽는다.

## 개발

- `npm test` 전체 테스트 (커널 테스트는 WASM 로드로 수 초). `npm run typecheck`.
- 커널 로직은 `src/kernel/evaluate.ts`, 스키마는 `src/model/schema.ts`. 둘을 바꾸면 `docs/schema.md`도 맞춘다.
- 커널 예외는 `WebAssembly.Exception`일 수 있다. `src/kernel/errors.ts`의 `errorMessage`로 변환한다.
- MCP 서버: 진입점 `server/mcp.ts`(stdio, `PORT` env로 감시 서버 포트), 도구는 `server/mcpServer.ts`, 검증은 `server/validate.ts`(Node에서 커널 직접 실행). `npm run mcp`로 단독 실행할 수 있다. stdout은 MCP 전송 전용이므로 로그는 stderr로만 쓴다(`console.log`도 stderr로 돌려 놓았다).
- 파일 쓰기는 `server/atomicWrite.ts`의 `writeFileAtomic`(임시 파일 + rename)로 한다. 뷰어 저장과 MCP 쓰기가 교차해도 반쯤 쓰인 파일이 보이지 않는다.
- 설계 문서: `docs/plans/2026-10-13-3designer-design.md`, 구현 계획: `docs/plans/2026-10-13-3designer-m1-m4.md`(M1~M4), `docs/plans/2026-10-14-3designer-m5-mcp.md`(M5 MCP).
