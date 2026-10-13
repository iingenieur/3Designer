# 3Designer

3D 프린팅용 AI 네이티브 파라메트릭 CAD. 사용자가 자연어로 요청하면 **Claude Code가 `*.3d.json` 피처 트리 파일을 편집**하고, 브라우저(`npm start -- <파일>`)가 즉시 다시 렌더링한다.

## 모델 편집 규칙

- 스키마는 `docs/schema.md`. 새 피처 타입이나 필드를 지어내지 않는다.
- 치수는 가능한 한 `parameters`에 변수로 두고 피처에서 수식으로 참조한다. 사용자가 "지름을 50으로" 하면 변수 하나만 바꾸면 되도록.
- 피처 `name`은 한국어로, 사용자가 트리에서 알아볼 수 있게 쓴다. `id`는 짧은 영문.
- 편집 후 `<파일>.errors.json`을 읽어 오류가 있으면 고친다. `schema`와 `features`가 모두 빈 배열이면 성공.
- 3D 프린팅 기본 상식을 적용한다: 바닥(Z=0)은 평평하게, 벽 두께 1.2mm 이상, 볼트 구멍은 공칭 지름 + 0.3~0.4mm 여유(M3 → Ø3.4), 45°를 넘는 오버행은 사용자에게 알린다.
- 사용자가 스케치·돌출·필렛·보스·컷 같은 SolidWorks 용어를 쓰면 그대로 이해한다. 사용자는 SolidWorks 경험자다. "보스 돌출" = extrude op add, "컷 돌출" = extrude op cut.
- 파일을 편집하는 동안 사용자가 UI에서 치수를 바꿨을 수 있으니, 편집 전에 항상 파일을 다시 읽는다.

## 개발

- `npm test` 전체 테스트 (커널 테스트는 WASM 로드로 수 초). `npm run typecheck`.
- 커널 로직은 `src/kernel/evaluate.ts`, 스키마는 `src/model/schema.ts`. 둘을 바꾸면 `docs/schema.md`도 맞춘다.
- 커널 예외는 `WebAssembly.Exception`일 수 있다. `src/kernel/errors.ts`의 `errorMessage`로 변환한다.
- 설계 문서: `docs/plans/2026-10-13-3designer-design.md`, 구현 계획: `docs/plans/2026-10-13-3designer-m1-m4.md`.
