# 3Designer

3D 프린팅을 위한 오픈소스 AI 네이티브 파라메트릭 CAD. Claude Code가 `*.3d.json` 피처 트리를 편집하고, 브라우저가 OpenCascade(WASM)로 형상을 계산해 보여준다. API 비용 없이 Claude Code 구독만으로 동작한다.

## 실행

    npm install
    npm start -- examples/flange.3d.json

브라우저에서 http://localhost:5173 을 연다. 서버(파일 감시 + WebSocket)는 5174 포트를 쓴다.

포트가 겹치면 `PORT=<번호> VITE_WS_PORT=<번호> npm start -- <모델>` 로 서버와 뷰어가 쓸 WebSocket 포트를 함께 바꾼다.

## 사용 흐름

1. `npm start -- <모델>.3d.json` 으로 서버와 뷰어를 켠다.
2. 같은 폴더에서 Claude Code를 열고 "볼트 구멍을 6개로 바꿔줘"처럼 요청한다. Claude Code가 파일을 편집하면 뷰어가 즉시 반영한다. 오류는 화면 배너와 `<모델>.errors.json`에 기록되어 Claude Code가 스스로 고칠 수 있다.
3. 오른쪽 패널에서 파라미터·치수를 직접 고치고, 피처 순서를 바꾸거나 끄거나 지울 수 있다. 고친 내용은 파일에 저장되어 다음 Claude Code 요청에 반영된다.
4. "STL 내보내기"로 슬라이서에 넘긴다.

모델 파일 형식: `docs/schema.md`. Claude Code 작업 규칙: `CLAUDE.md`.

### Claude Code MCP 연동

프로젝트 폴더에서 Claude Code를 열면 저장소 루트의 `.mcp.json`을 감지해 `3designer` MCP 서버 승인을 묻는다. 승인하면 Claude Code가 파일을 손으로 고치는 대신 다음 도구로 모델을 다루고, 매번 검증 결과(오류·치수·부피·프린트 경고)를 바로 돌려받는다.

- `get_model` — 현재 모델 파일을 읽는다 (편집 전 최신 상태 확인).
- `validate` — 스키마 → 수식 → 커널 순으로 검증한다. `model`을 주면 파일을 건드리지 않고 그 모델만 시험한다.
- `write_model` — 모델 전체를 검증 후 쓴다 (스키마 오류면 쓰지 않는다).
- `set_parameter` — `parameters` 변수 하나를 바꾸거나 새로 만든다.
- `add_feature` / `update_feature` / `delete_feature` — 피처를 추가(위치 지정 가능)·얕게 병합 수정(`suppressed`로 끄기 포함)·삭제한다.
- `screenshot` — 브라우저 뷰어의 현재 3D 화면을 PNG로 받는다.

검증은 Node 안에서 OpenCascade를 직접 돌리므로 브라우저 없이도 동작한다. `screenshot`만 `npm start`로 띄운 서버와 열린 브라우저(http://localhost:5173)가 필요하다. 모델 파일 스키마는 MCP 리소스 `doc://3designer/schema`로도 제공된다.

다른 폴더에서 쓰려면 Claude Code에 직접 등록한다.

    claude mcp add 3designer -- npx tsx /절대경로/3Designer/server/mcp.ts

서버 포트를 바꿨다면(`PORT=<번호> npm start …`) MCP 서버에도 같은 `PORT`를 줘야 감시 중인 파일과 스크린샷을 찾을 수 있다. `.mcp.json`의 서버 항목에 `"env": {"PORT": "<번호>"}`를 추가한다.

## 피처 (현재)

box · cylinder · sphere · extrude(rect/circle/polygon, XY/XZ/YZ) · 선형/원형 pattern · hole · fillet · chamfer. 모든 치수는 `parameters` 변수를 참조하는 수식(`"D/2"`)을 쓸 수 있다.

## 구조

- `src/model/` 스키마(Zod), 수식 평가기, 편집 함수
- `src/kernel/` replicad(OpenCascade WASM) 피처 평가, Web Worker, 오류 변환
- `src/state/` Zustand 스토어, WebSocket 연결
- `src/ui/` React + Three.js 뷰포트, 피처 트리, 인스펙터
- `server/` 파일 감시 + WebSocket 서버, MCP 서버(`mcp.ts` 진입점, `mcpServer.ts` 도구, `validate.ts` Node 검증, `relay.ts` 스크린샷 중계)
- `examples/` 예제 모델 (플랜지, 박스 뚜껑)

## 개발

    npm test          # Vitest (커널 테스트는 WASM 로드로 수 초)
    npm run typecheck
    npm run build

설계 문서 `docs/plans/2026-10-13-3designer-design.md`, 구현 계획 `docs/plans/2026-10-13-3designer-m1-m4.md`(M1~M4), `docs/plans/2026-10-14-3designer-m5-mcp.md`(M5 MCP 서버).

`npm run mcp`로 MCP 서버를 단독 실행할 수 있다(stdio). 로그는 stderr로 나간다.

## 로드맵

- M5 (완료): MCP 서버 — Claude Code가 이름 붙은 도구로 피처를 추가하고 검증 결과·스크린샷을 돌려받는다.
- M6: 3D 뷰 직접 조작 — 클릭 선택, 드래그 기즈모, 면 지정.

## 라이선스

MIT (예정). replicad(MIT), opencascade.js/OCCT(LGPL 2.1 예외 조항) 사용.
