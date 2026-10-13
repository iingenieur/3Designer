# 3Designer 설계 문서

작성일: 2026-10-13

## 1. 목표

3D 프린팅을 위한 오픈소스 AI 네이티브 파라메트릭 CAD.
사용자가 Claude Code 터미널에서 한국어로 설명하면 AI가 모델을 만들고,
브라우저 뷰어가 형상을 계산해 보여주며, 사용자는 UI에서 치수와 피처를
직접 수정하고 STL로 내보내 프린트한다.

### 배경

- 사용자는 10년 전 SolidWorks 경험자. 파라메트릭 CAD 사고방식(스케치 →
  돌출 → 피처 트리)에는 익숙하지만 세부 조작법은 잊었다.
- 기존 CAD 툴은 AI가 작업 흐름 안에 없어서 기능 하나 쓰려면 help를
  일일이 찾아야 한다.
- 상용 툴(Tinkercad, Fusion 360, Zoo)의 오픈소스 대체재를 지향한다.
  (ArtCraft가 Adobe 제품군에 대해 한 것과 같은 방향)

### 핵심 결정

| 결정 | 선택 | 이유 |
|---|---|---|
| 사용자/모델링 방식 | 파라메트릭 피처 트리 | SolidWorks 경험 활용, AI가 생성·수정하기 좋음 |
| AI 상호작용 | 대화로 생성 → 이후 코파일럿으로 확장 | 첫 버전 구조가 단순 |
| 실행 환경 | 웹 앱 (브라우저) + 로컬 Node 서버 | 설치 없이 접속, 배포 쉬움 |
| 모델 표현 | JSON 피처 트리 (`*.3d.json`) | UI 편집과 AI 편집이 같은 데이터 공유, 피처 트리 UI 자연스러움 |
| AI 비용 | Claude Code(구독)가 두뇌, API 비용 0 | 파일 편집 → 이후 MCP 서버 |
| CAD 커널 | replicad (OpenCascade.js 위 MIT 라이브러리) | 스케치/돌출/필렛/불리언/STL·STEP 내장, 면·모서리 finder 제공 |

## 2. 선행 프로젝트 조사 (2026-10-13)

- **kernelCAD** (MIT): 에이전트 네이티브 CAD. 모델을 TypeScript 코드로
  표현, replicad 사용, CLI + MCP + Claude Code 플러그인. UI는 검토용.
  우리와의 차이: JSON 피처 트리 + UI 직접 편집.
- **replicad** (MIT): OpenCascade.js 래퍼. 2026-09 활동. 커널 층으로 채택.
- **Zoo / KCL** (상용): 텍스트 언어로 모델 표현, 모서리 참조를 태그로.
  우리의 의미 기반 선택자 접근을 뒷받침.
- **chili3d** (AGPL): 브라우저 CAD, OCCT 8 WASM + Three.js. 피처 트리 없음.
  스케치 편집기 UI 참고용.
- **FreeCAD MCP 서버들**: 가장 성숙한 "Claude Code로 CAD" 조합. 데스크톱
  필요. 당장 쓸 수 있는 대안.
- **CAD MCP 비교 교훈**: 에이전트가 결과를 읽어 돌아올 수 있어야 하고,
  임의 코드 실행보다 이름 붙은 연산 도구가 안전하다.

## 3. 전체 구조

```
 Claude Code (터미널, 구독)                    브라우저 (localhost:5173)
 ┌──────────────────────┐                    ┌───────────────────────────┐
 │ 사용자: "원통에 M3   │   1단계: 파일 편집  │ [3D 뷰포트]  [피처 트리]  │
 │  구멍 4개 뚫어줘"    │ ───────────────────▶│      ▲            │       │
 │                      │  part.3d.json       │      │  메시      │ 치수  │
 │ 2단계: MCP 도구 호출 │ ◀──검증 결과/스샷── │ [커널 Worker] ◀──────────┘│
 └──────────────────────┘                    │ [STL 내보내기]            │
                                             └───────────────────────────┘
                          ▲ 로컬 Node 서버: 파일 감시 + WebSocket + (2단계) MCP
```

### 구성 요소

- **피처 트리 파일** (`part.3d.json`): 유일한 진실의 원천. JSON Schema 제공.
- **로컬 서버** (Node): 프로젝트 파일 감시, 변경 시 WebSocket으로 브라우저에
  전달. 브라우저의 오류를 `part.3d.errors.json`에 기록해 Claude Code가 읽음.
  2단계에서 MCP 서버 역할 추가.
- **커널** (`src/kernel/`): replicad를 Web Worker에서 실행. 피처를 순서대로
  평가해 B-rep 솔리드 생성, 메시 변환. 피처별 중간 결과 캐시.
- **뷰어 UI** (React + Three.js): 3D 뷰, 피처 트리 패널, 치수 편집, STL
  내보내기, 오류 배너.
- **CLAUDE.md**: 스키마 요약과 작업 규칙(단위 mm, 프린트 가능성 체크 등).

### 기술 스택

Vite + React + TypeScript, Three.js, replicad (+ opencascade.js WASM),
Zustand, Zod, Node (chokidar + ws), 2단계에 `@modelcontextprotocol/sdk`.

## 4. 피처 트리 스키마

```json
{
  "version": 1,
  "units": "mm",
  "parameters": { "D": 40, "H": 20, "boltPCD": 30 },
  "features": [
    { "id": "f1", "type": "cylinder", "name": "본체",
      "radius": "D/2", "height": "H" },
    { "id": "f2", "type": "hole", "name": "볼트 구멍",
      "face": { "of": "f1", "select": "top" },
      "diameter": 3.4, "depth": "through",
      "positions": { "pattern": "circular", "count": 4, "diameter": "boltPCD" } },
    { "id": "f3", "type": "fillet", "name": "윗면 필렛",
      "edges": { "of": "f1", "select": "top" }, "radius": 2 }
  ]
}
```

### 원칙

- **파라미터 테이블**: 치수를 변수로 두고 수식("D/2") 허용. 숫자 또는
  수식 문자열 모두 가능.
- **순서 평가**: 각 피처는 이전 결과에 적용. 실패한 피처는 건너뛰고 계속.
- **의미 기반 선택자**: `top`, `bottom`, `side`, `all`. 커널 인덱스를 쓰지
  않아 치수 변경 시 참조가 깨지지 않음 (토폴로지 명명 문제 회피).
  replicad의 FaceFinder/EdgeFinder로 구현.
- **첫 버전 피처 6종**: `box`/`cylinder`/`sphere`, `extrude`(파라미터 2D
  도형 + 높이), `boolean`(union/subtract/intersect), `hole`,
  `fillet`/`chamfer`, `pattern`(linear/circular).
- **배치**: 모든 피처는 선택적 `transform`(position, rotation).
- **검증**: JSON Schema + Zod. 오류 위치와 이유를 UI와 Claude Code에 표시.

## 5. 데이터 흐름

1. 파일 변경 (Claude Code 편집 또는 UI 편집 → 저장).
2. 서버가 감지, WebSocket으로 브라우저에 새 JSON 전달.
3. 브라우저가 Zod 검증, 수식 평가 → 평가된 피처 트리.
4. Worker의 replicad가 피처를 순서대로 실행. 단계별 솔리드 캐시.
5. 메시 변환 → Three.js 렌더링. 피처별 면 색 구분, 트리와 뷰 상호 하이라이트.

UI 편집: 입력 → 메모리 즉시 반영 → 300ms 디바운스 후 파일 저장 → 서버는
내용 동일 시 무시.

## 6. 오류 처리

원칙: 절대 빈 화면을 보여주지 않는다.

| 오류 | 처리 |
|---|---|
| 스키마 오류 | 마지막 성공 모델 유지, 배너에 위치와 이유 |
| 수식 오류 | 해당 피처 건너뜀, 트리에 빨간 표시 |
| 커널 오류 (필렛 실패 등) | 해당 피처 suppress, 나머지 계산, 원인 표시 |
| Worker 크래시 | 자동 재시작, 마지막 성공 메시 유지 |

오류는 `part.3d.errors.json`에 기록 (1단계), MCP 도구 응답으로 반환 (2단계).

프린트 적합성 (1단계 기본): 바운딩 박스, 부피 표시. 바닥면 비평탄 또는
Z<0 걸침 시 경고.

## 7. UI 편집 범위

- **1단계 (피처 트리 패널)**: 모든 치수 수정(숫자/슬라이더), 피처 순서
  변경·suppress·삭제, 위치/회전 수정, 피처 종류 변경.
- **2단계 (3D 뷰 직접 조작)**: 클릭 선택, 드래그 기즈모
  (TransformControls), 면/모서리 클릭으로 참조 지정.
- **나중**: 구속 솔버 기반 2D 스케치 편집기.

## 8. 프로젝트 구조

```
3Designer/
├── CLAUDE.md
├── schema/part.schema.json
├── examples/
├── src/
│   ├── model/     # Zod 스키마, 수식 평가기, 타입
│   ├── kernel/    # replicad 기반 피처 평가기 (Worker)
│   ├── state/     # Zustand 스토어
│   └── ui/        # 뷰포트, 피처 트리, 치수 패널, 오류 배너
├── server/        # 파일 감시 + WebSocket (2단계: MCP)
└── docs/plans/
```

## 9. 테스트 전략

- `model/`, `kernel/`: Vitest 단위 테스트. replicad는 Node 헤드리스로
  실행 가능하므로 형상 검증(부피, 바운딩 박스, 면 개수)을 UI 없이 수행.
- 예제 모델별 스냅샷 테스트로 커널 회귀 방지.
- UI: Playwright 스모크 테스트 최소한.

## 10. 마일스톤

| 단계 | 결과물 |
|---|---|
| M1 뷰어 | 예제 JSON 열어 박스/원통 렌더링, STL 내보내기 |
| M2 피처 완성 | 6종 피처 + 파라미터 수식 + 피처별 오류 처리 |
| M3 Claude Code 연동 | 파일 감시 + 핫 리로드 + CLAUDE.md |
| M4 UI 편집 | 피처 트리 패널, 치수 편집, 순서/삭제/suppress, 파일 역저장 |
| M5 MCP 서버 | 이름 붙은 도구 + 검증 결과/스크린샷 반환 |
| M6 3D 직접 조작 | 클릭 선택, 드래그 기즈모, 면 지정 |

M3까지가 "Claude Code와 함께 설계하는" 최소 경험, M4까지가 1단계 범위.

## 11. 보류/나중 결정

- BYOK API 호출(Claude Code 없이 사용): 선택 기능으로 나중에.
- 로컬 LLM(Ollama): 품질 확인 후 선택 옵션.
- 라이선스: MIT 예정 (replicad, opencascade.js 호환. OCCT는 LGPL 예외 조항).

## 참고 링크

- kernelCAD: https://github.com/w1ne/kernelCAD-web
- replicad: https://github.com/sgenoud/replicad
- chili3d: https://github.com/xiangechen/chili3d
- opencascade.js (유지보수 포크): https://github.com/taucad/opencascade.js
- Zoo Text-to-CAD: https://zoo.dev/blog/introducing-text-to-cad
- CAD MCP 비교: https://techdrawai.com/blog/cad-mcp-servers
