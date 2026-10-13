# 3Designer 모델 파일 스키마 (`*.3d.json`)

3Designer 모델은 JSON 파일 하나다. 피처(feature)를 **위에서 아래로 순서대로** 적용해 바디 하나를 만든다.

- 단위는 **mm**, **Z가 위**다 (3D 프린터 베드가 z=0 평면).
- 기본 바디(box/cylinder/extrude)는 **XY 중심이 원점**이고 **z=0 위에 놓인다** (바닥면이 베드).
- 정식 정의는 `src/model/schema.ts`(zod)이고, 이 문서는 거기에 맞춘 설명이다. 여기 없는 타입·필드는 존재하지 않는다.

## 최상위

| 필드 | 타입 | 설명 |
|---|---|---|
| `version` | `1` | 항상 1 |
| `units` | `"mm"` | 항상 "mm" |
| `parameters` | `{ [이름]: number }` | 치수 변수. 값은 **숫자만** (수식 불가). 생략하면 `{}` |
| `features` | `Feature[]` | 순서대로 적용되어 바디 하나를 만든다 |

```json
{
  "version": 1,
  "units": "mm",
  "parameters": { "D": 40, "H": 8 },
  "features": [ ... ]
}
```

## 수식

피처의 모든 **숫자 필드**는 숫자 대신 수식 문자열을 받는다. `"radius": "D/2"`, `"height": "H + bossH"`, `"position": [0, 0, "T"]` 처럼 쓴다.

- 변수: `parameters`의 이름
- 연산자: `+ - * / ^ ( )`, 단항 마이너스. 우선순위는 수학 관례대로 (`-2^2` = -4, `^`는 오른쪽 결합)
- 함수: `sqrt abs sin cos tan min max floor ceil round` — 삼각함수는 **도(deg)** 단위. 예: `"sqrt(2)*D"`, `"max(wall, 1.2)"`, `"R*cos(30)"`
- 수식으로 평가되지 **않는** 문자열 필드: `id name type op edges plane kind pattern direction units`, 그리고 `depth`의 `"through"`
- 수식 오류(모르는 변수, 문법 오류)는 그 피처만 실패시키고(`stage: "expression"`) 나머지는 계속 평가된다

## 공통 필드 (모든 피처)

| 필드 | 타입 | 기본값 | 설명 |
|---|---|---|---|
| `id` | string | 필수 | 파일 안에서 **유일**해야 한다. 짧은 영문 (`"body"`, `"bolts"`) |
| `type` | string | 필수 | 아래 피처 타입 중 하나 |
| `name` | string | 없음 | 트리에 보이는 이름. **한국어 권장** (`"본체"`, `"볼트 구멍"`) |
| `suppressed` | boolean | `false` | true면 평가에서 완전히 제외 (오류도 내지 않음) |
| `transform` | object | 없음 | `{ "position": [x, y, z], "rotation": [rx, ry, rz] }`. 둘 다 선택. 회전은 **도(deg)**, **원점 기준**으로 X→Y→Z 순서로 적용한 뒤 이동한다 |

바디 피처에서는 `pattern`을 먼저 적용하고 그 결과 전체에 `transform`을 적용한다. hole에서는 `transform`이 드릴 공구(원기둥)에 적용된다.

## 바디 피처: `box` `cylinder` `sphere` `extrude`

솔리드를 하나 만들어 현재 바디와 합친다. 공통 추가 필드:

| 필드 | 타입 | 기본값 | 설명 |
|---|---|---|---|
| `op` | `"add"` \| `"cut"` \| `"intersect"` | `"add"` | 현재 바디와 합치기/빼기/교집합. **첫 바디는 반드시 add** (앞에 바디가 없는 cut/intersect는 오류) |
| `pattern` | object | 없음 | 복제 패턴 (아래). 복제본은 하나로 합쳐진 뒤 `op`로 적용된다 |

### `pattern`

| 형태 | 필드 | 설명 |
|---|---|---|
| `{ "pattern": "linear", "count", "spacing", "direction" }` | `direction`: `"X"` \| `"Y"` \| `"Z"`, 기본 `"X"` | 원본을 포함해 `count`개를 `spacing` 간격으로 `direction` 양의 방향으로 복제 |
| `{ "pattern": "circular", "count", "diameter", "startAngle" }` | `startAngle` 기본 `0` (도) | 원점 중심, **피치원 지름** `diameter` 위에 `count`개를 등간격 배치. 원본 위치는 포함되지 않고 모두 피치원 위에 놓인다 |

`count`는 1 이상의 **정수**여야 한다 (수식 결과가 정수가 아니면 피처 오류).

### 타입별 필드

| 타입 | 필드 | 형상 |
|---|---|---|
| `box` | `size: [x, y, z]` | XY 중심 원점, z=0 ~ z |
| `cylinder` | `radius`, `height` | 축 Z, 중심 원점, z=0 ~ height |
| `sphere` | `radius` | **중심이 원점** → 절반이 z=0 아래. 베드 위에 올리려면 `transform.position: [0, 0, "R"]` |
| `extrude` | `profile`, `plane`, `offset`, `height` | 2D 프로파일을 `plane` 위에 그려 법선 방향으로 `height`만큼 돌출 |

### `extrude` 상세

| 필드 | 타입 | 기본값 | 설명 |
|---|---|---|---|
| `profile` | object | 필수 | 아래 프로파일 중 하나. 평면 원점 중심 |
| `plane` | `"XY"` \| `"XZ"` \| `"YZ"` | `"XY"` | 스케치 평면 |
| `offset` | number | `0` | 평면을 법선 방향으로 띄우는 거리 |
| `height` | number | 필수 | 돌출 길이 (법선 방향) |

평면 법선 방향 (돌출·offset 방향):

- `XY` → **+Z** (일반적인 바닥 스케치. 결과는 z=offset 위에 놓인다)
- `XZ` → **−Y** (돌출이 −Y로 간다. offset도 −Y로 이동)
- `YZ` → **+X**

프로파일:

| `kind` | 필드 | 설명 |
|---|---|---|
| `"rect"` | `width`, `height`, `cornerRadius?` | 직사각형. `cornerRadius`를 주면 네 모서리를 둥글린다 (XY 평면에서 width는 X, height는 Y) |
| `"circle"` | `radius` | 원 |
| `"polygon"` | `sides`, `radius` | 정다각형. `radius`는 **외접원 반지름** (꼭짓점까지 거리). 육각 볼트 머리 등 |

SolidWorks 용어로: 보스 돌출 = `extrude` + `op: "add"`, 컷 돌출 = `extrude` + `op: "cut"`.

## 수정 피처: `hole` `fillet` `chamfer`

현재 바디를 가공한다. 앞에 바디가 없으면 오류.

`hole`의 `transform`은 `position`만 적용되어 모든 구멍 위치를 함께 이동시키며, `rotation`은 무시된다. `fillet`/`chamfer`의 `transform`은 무시된다.

### `hole`

| 필드 | 타입 | 기본값 | 설명 |
|---|---|---|---|
| `diameter` | number | 필수 | 구멍 지름 |
| `depth` | `"through"` \| number | `"through"` | 관통 또는 윗면에서 아래로 깊이 |
| `positions` | `[[x, y], ...]` (1개 이상) \| `pattern` 객체 | 필수 | 구멍 위치. `pattern`은 위 바디 패턴과 같은 형식 (`circular`가 볼트 원에 편리) |

현재 바디의 **윗면(바운딩 박스 최대 Z)** 에서 **아래로** 뚫는다. `through`면 바디 전체를 관통한다. 평평한 윗면에 수직 구멍을 뚫는 용도이며, 옆면 구멍은 `cylinder` + `op: "cut"` + `transform.rotation`으로 만든다.

### `fillet` / `chamfer`

| 타입 | 필드 | 기본값 | 설명 |
|---|---|---|---|
| `fillet` | `radius`, `edges` | `edges: "all"` | 모서리 라운드 |
| `chamfer` | `distance`, `edges` | `edges: "all"` | 모서리 모따기 |

`edges` 선택자는 현재 바디의 바운딩 박스로 정의된다:

| 값 | 선택되는 모서리 |
|---|---|
| `"top"` | z = (바운딩 박스 최대 Z) 평면에 놓인 모서리 — 즉 맨 윗면 둘레 |
| `"bottom"` | z = (바운딩 박스 최소 Z) 평면에 놓인 모서리 — 바닥면 둘레 (3D 프린팅에서는 바닥 필렛은 작게) |
| `"vertical"` | Z축에 평행한 모서리 (상자의 세로 모서리) |
| `"all"` | 모든 모서리 |

반지름이 인접 면 두께보다 크면 커널이 실패한다(`stage: "kernel"`). 그 경우 값을 줄이거나 선택자를 좁힌다. 보스처럼 높이가 다른 면이 있으면 `"top"`은 가장 높은 면 둘레만 잡는다.

## 오류 파일

브라우저가 모델을 로드·평가할 때마다 같은 폴더의 `<파일명>.errors.json`에 결과를 쓴다 (`flange.3d.json` → `flange.3d.errors.json`). 뷰어(`npm start`)가 떠 있어야 갱신된다.

```json
{
  "schema": [ { "path": "features.2.radius", "message": "..." } ],
  "features": [ { "featureId": "edge", "stage": "kernel", "message": "..." } ]
}
```

- `schema`: JSON 문법 오류, 스키마 위반, id 중복. 하나라도 있으면 모델 전체가 거부되고 **마지막 성공 모델이 그대로 표시**된다. `path`는 문제 위치 (`features.3.positions`), 문법 오류면 빈 문자열
- `features`: 피처별 오류. 스키마 오류가 있으면 `features`는 빈 배열이다 (표시 중인 모델은 이전 성공본). `stage`는 `"expression"`(수식) 또는 `"kernel"`(형상 연산). 실패한 피처는 건너뛰고 나머지는 계속 평가된다. `featureId: "*"`는 특정 피처가 아닌 커널 전체 실패
- **둘 다 빈 배열이면 성공**

## 예제

- `examples/flange.3d.json` — 원형 플랜지: 본체 + 보스 + 중심 구멍 + 볼트 원형 패턴 + 윗면 필렛
- `examples/box-lid.3d.json` — 상자 뚜껑: 둥근 사각 돌출 + 립 보스/컷 + 바닥 필렛

```json
{
  "version": 1,
  "units": "mm",
  "parameters": { "D": 40, "H": 8, "bossH": 6, "boltPCD": 30 },
  "features": [
    { "id": "body", "type": "cylinder", "name": "본체", "radius": "D/2", "height": "H" },
    { "id": "boss", "type": "cylinder", "name": "보스", "radius": 8, "height": "H + bossH" },
    { "id": "bore", "type": "cylinder", "name": "중심 구멍", "radius": 4, "height": "H + bossH", "op": "cut" },
    { "id": "bolts", "type": "hole", "name": "볼트 구멍", "diameter": 3.4,
      "positions": { "pattern": "circular", "count": 4, "diameter": "boltPCD" } },
    { "id": "edge", "type": "fillet", "name": "윗면 필렛", "radius": 1, "edges": "top" }
  ]
}
```
