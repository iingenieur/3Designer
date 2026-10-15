#!/bin/zsh
# 전체 화면을 캡처해 2056px 폭으로 저장한다 → 이미지 1px = 화면 1pt (Retina 2x 가정). 사용법: shot.sh <출력.png>
# 화면 기록 권한이 없으면 "could not create image from display"가 난다.
set -e
OUT=${1:-/tmp/shot.png}
screencapture -x "$OUT"
W=$(osascript -e 'tell application "Finder" to get bounds of window of desktop' | awk -F', ' '{print $3}')
sips -Z "$W" "$OUT" >/dev/null
echo "$OUT ${W}pt wide"
