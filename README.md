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

## 피처 (현재)

box · cylinder · sphere · extrude(rect/circle/polygon, XY/XZ/YZ) · 선형/원형 pattern · hole · fillet · chamfer. 모든 치수는 `parameters` 변수를 참조하는 수식(`"D/2"`)을 쓸 수 있다.

## 구조

- `src/model/` 스키마(Zod), 수식 평가기, 편집 함수
- `src/kernel/` replicad(OpenCascade WASM) 피처 평가, Web Worker, 오류 변환
- `src/state/` Zustand 스토어, WebSocket 연결
- `src/ui/` React + Three.js 뷰포트, 피처 트리, 인스펙터
- `server/` 파일 감시 + WebSocket 서버
- `examples/` 예제 모델 (플랜지, 박스 뚜껑)

## 개발

    npm test          # Vitest (커널 테스트는 WASM 로드로 수 초)
    npm run typecheck
    npm run build

설계 문서 `docs/plans/2026-10-13-3designer-design.md`, 구현 계획 `docs/plans/2026-10-13-3designer-m1-m4.md`.

## 로드맵

- M5: MCP 서버 — Claude Code가 이름 붙은 도구로 피처를 추가하고 검증 결과·스크린샷을 돌려받는다.
- M6: 3D 뷰 직접 조작 — 클릭 선택, 드래그 기즈모, 면 지정.

## 라이선스

MIT (예정). replicad(MIT), opencascade.js/OCCT(LGPL 2.1 예외 조항) 사용.
