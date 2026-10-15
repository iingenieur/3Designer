---
name: printing-with-bambu-x2d
description: Use when a 3Designer model (*.3d.json) must become a real print on the user's Bambu Lab X2D — exporting STL from the kernel, slicing with the Bambu Studio command line, checking print time/filament, or driving the Bambu Studio GUI to send the job from a Claude Code session that has only Bash/Chrome tools (no computer-use).
---

# 3Designer 모델을 Bambu Lab X2D로 출력하기

## 개요

설계(MCP 도구) → STL 내보내기 → CLI 슬라이싱(출력 가능성·시간·무게 확인) → Bambu Studio GUI로 전송.
CLI는 **프린터 전송 기능이 없다.** 전송은 GUI를 화면 캡처 + 실제 마우스 이벤트(CGEvent)로 조작한다.
스크립트는 `.claude/skills/printing-with-bambu-x2d/scripts/`에 있다. 아래에서 `$SK`는 그 폴더이고, 저장소 루트에서 실행한다.

    SK=.claude/skills/printing-with-bambu-x2d/scripts

## 필요한 세팅 (처음 한 번)

| 항목 | 확인 방법 | 없으면 |
|---|---|---|
| Bambu Studio 02.08+ | `ls /Applications/BambuStudio.app` | `brew install --cask bambu-studio` (약 500 MB, 사용자 허락 필요) |
| Studio 로그인 + 프린터 바인딩 | Device 탭에 `3DP-20P-078`(X2D) 표시 | 사용자가 직접 로그인 (비밀번호는 대신 입력하지 않는다) |
| 화면 기록 권한 (Claude Code를 띄운 터미널 앱) | `screencapture -x /tmp/a.png` 성공 | 실패 메시지 "could not create image from display" → 사용자에게 시스템 설정 > 개인정보 보호 > 화면 기록 요청 |
| 손쉬운 사용(Accessibility) 권한 (같은 터미널 앱) | `osascript -e 'tell application "System Events" to UI elements enabled'` → true | 사용자에게 요청. CGEvent 클릭에 필요 |
| Swift 컴파일러 | `xcrun swift --version` | Xcode Command Line Tools |
| 클릭 도구 빌드 (세션마다) | `swiftc -O $SK/clicker.swift -o /tmp/clicker` | — |
| 디스플레이 하나 | `$SK/shot.sh`가 캡처를 Finder 데스크톱 폭(pt)으로 줄여 **이미지 1px = 화면 1pt** (배율 무관) | 모니터가 여럿이면 캡처가 디스플레이별로 나뉘어 좌표가 어긋난다. 하나만 켜거나 주 디스플레이에서 작업 |

## 흐름

1. **설계·검증**: CLAUDE.md의 MCP 도구(`get_model` → `validate`/`write_model`). 경고·오류 0, 바닥 Z=0 확인. 뷰어 드롭다운으로 모델을 바꾸면 MCP 기본 path도 따라온다.
2. **STL**: `node --import tsx $SK/export-stl.mts examples/<모델>.3d.json examples/<모델>.stl`
   → JSON 한 줄. `nonManifoldEdges` 0, `min[2]` 0, `bytes == bytesExpected` 아니면 종료 코드 1.
3. **CLI 슬라이싱**: `$SK/slice-x2d.sh examples/<모델>.stl examples/sliced-x2d [--support]`
   → `{time, layers, filament_g, filament_density, warnings}`. `warnings`에 "floating regions"가 있으면 `--support`로 다시 돌리거나 형상을 고친다. 평판처럼 오버행이 없는 부품엔 서포트가 필요 없다(켜도 0 g). 실패하면 `<모델>.slice.log`를 읽는다. 결과 폴더는 gitignore.
4. **GUI 전송** (사용자가 출력을 요청했을 때만):
   1. `pgrep -fl BambuStudio`로 이미 떠 있는 창을 확인한다. `open -a`는 매번 새 창을 만들므로, 같은 파일이 열려 있으면 그 창을 쓰고, 다른 파일 창은 `osascript -e 'quit app "BambuStudio"'`로 닫는다(저장 묻는 창이 뜨면 캡처 후 "Don't Save"를 clicker로).
   2. `open -a BambuStudio examples/sliced-x2d/<모델>.gcode.3mf` → 10초 대기.
   3. `$SK/shot.sh /tmp/s.png` → Read로 보고, 버튼 좌표를 이미지에서 읽는다.
   4. `/tmp/clicker <x> <y>`로 **Slice plate** → "Sync now" 경고가 뜨면 Sync now(프린터의 노즐·AMS 반영, 자동 재슬라이싱). 동기화는 프로세스 프리셋을 바꿀 수 있으니 서포트가 필요한 부품이면 Preview에서 서포트가 살아 있는지 다시 본다.
   5. Preview에서 **Print plate** → "Send print job" 창. 프린터 이름, 플레이트, 필라멘트 매핑을 확대(`sips -c <h> <w> --cropOffset <y> <x>`)해서 확인한다. 슬롯을 바꾸려면 Main Nozzle 아래 필라멘트 칩(예: "PLA / A4")을 클릭 → AMS 슬롯 격자에서 원하는 칸 클릭. 슬롯 색은 스풀 교체로 바뀌므로 표(A1 흰/A2 검정/A3 회색/A4 초록)를 믿지 말고 격자의 색 견본을 본다.
   6. **Send는 사용자가 명시적으로 출력을 요청한 경우에만** 누른다. 그렇지 않으면 창을 캡처해 보여 주고 확인을 받는다. 프린터 이름이 다르거나, 색이 다르거나, 무게가 0이면 누르지 않는다.
   7. "Successfully sent" 확인 후 Device 탭 캡처로 베드 예열·진행 상태를 보고한다.

## 함정 (모두 실제로 겪은 것)

| 증상 | 원인 → 대응 |
|---|---|
| `System Events click at`·`keystroke "r"`가 아무 반응 없음 | Bambu Studio가 합성 이벤트 무시 → `clicker`(CGEvent)만 쓴다 |
| `--enable_support 1` → exit 254 | 플래그는 하이픈·값 없음: `--enable-support --support-type "tree(auto)"` (래퍼 `--support`) |
| 무게 0 g, `filament_density: 0`, 속도가 기본값 | CLI가 프로필 `inherits`를 풀지 않음 → 래퍼가 `flatten-profile.py`로 평탄화해서 넘긴다 |
| G-code 헤더 "total filament volume [cm^3]" | 실제 단위는 mm³ |
| CLI 시간 < GUI 시간 (예: 8분 vs 14분) | GUI는 프린터 동기화 후 재슬라이싱(곡선 계획 등) → 보고는 GUI 값 기준 |
| 화면에 모든 창이 펼쳐짐(미션 컨트롤) | `osascript -e 'tell application "System Events" to key code 53'`로 닫는다 |
| 창이 두 개(이전 3MF가 열려 있음) | `open -a`는 새 창을 만든다. System Events는 그중 하나만 "front window"로 보고하므로 창 제목은 캡처로 확인한다 |
| 화면 기록 권한 확인이 "읽기 전용"이 아님 | `screencapture`는 파일을 쓴다. `/tmp`에 쓰고 지운다 |
| `--export-png`가 exit 254 | 미지원으로 간주. 미리보기는 GUI 캡처로 |
| Preview에서 Print plate가 회색 | 아직 GUI 슬라이싱 전 → Slice plate 먼저 |

## 보고할 것

시간·무게는 GUI "Send print job" 창 값, 필라멘트 슬롯과 색, 전송 성공 메시지, Device 탭 상태. 파일 경로 3개(`.3d.json`, `.stl`, `.gcode.3mf`).
