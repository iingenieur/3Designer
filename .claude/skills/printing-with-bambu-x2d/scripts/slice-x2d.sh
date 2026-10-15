#!/bin/zsh
# Bambu Studio CLI로 STL을 X2D용으로 슬라이싱한다.
# 사용법: slice-x2d.sh <입력.stl> <출력폴더> [--support] [--process "0.20mm Standard @BBL X2D"] [--filament "Bambu PLA Basic @BBL X2D 0.4 nozzle"]
# 결과: <출력폴더>/<이름>.gcode.3mf 와 <출력폴더>/<이름>.slice.log (CLI 전체 출력). 요약(JSON) 한 줄을 stdout에 출력한다.
# 작업 파일(plate_1.gcode, result.json)은 임시 폴더에 두므로 모델이 달라도 서로 덮어쓰지 않는다.
set -e
HERE=$(cd "$(dirname "$0")" && pwd)
B=/Applications/BambuStudio.app/Contents/MacOS/BambuStudio
P=/Applications/BambuStudio.app/Contents/Resources/profiles/BBL
[ -x "$B" ] || { echo "Bambu Studio가 없습니다: brew install --cask bambu-studio" >&2; exit 2; }
IN=$1; OUT=$2; shift 2
MACHINE="Bambu Lab X2D 0.4 nozzle"; PROCESS="0.20mm Standard @BBL X2D"; FILAMENT="Bambu PLA Basic @BBL X2D 0.4 nozzle"; EXTRA=()
while [ $# -gt 0 ]; do
  case $1 in
    --support) EXTRA+=(--enable-support --support-type "tree(auto)"); shift ;;   # 언더스코어 형식(--enable_support 1)은 exit 254
    --process) PROCESS=$2; shift 2 ;;
    --filament) FILAMENT=$2; shift 2 ;;
    *) echo "모르는 옵션: $1" >&2; exit 2 ;;
  esac
done
NAME=$(basename "$IN" .stl)
mkdir -p "$OUT"; IN=$(cd "$(dirname "$IN")" && pwd)/$(basename "$IN"); OUT=$(cd "$OUT" && pwd)
WORK=$(mktemp -d); cd "$WORK"
# CLI는 프로필의 inherits를 풀지 않아 밀도(무게)·속도가 기본값이 된다 → 체인을 평탄화한 JSON을 넘긴다
FL=$(mktemp -d)
python3 "$HERE/flatten-profile.py" machine "$MACHINE" "$FL/machine.json" >/dev/null
python3 "$HERE/flatten-profile.py" process "$PROCESS" "$FL/process.json" >/dev/null
python3 "$HERE/flatten-profile.py" filament "$FILAMENT" "$FL/filament.json" >/dev/null
"$B" --load-settings "$FL/machine.json;$FL/process.json" --load-filaments "$FL/filament.json" \
  "${EXTRA[@]}" --debug 2 --arrange 1 --slice 0 --export-3mf "$NAME.gcode.3mf" --outputdir "$WORK" "$IN" >"$OUT/$NAME.slice.log" 2>&1 \
  || { echo "슬라이싱 실패 (exit $?). 로그: $OUT/$NAME.slice.log" >&2; exit 1; }
cp "$WORK/$NAME.gcode.3mf" "$OUT/"
G=plate_1.gcode
TIME=$(grep -m1 "^; model printing time" $G | sed 's/.*time: \([^;]*\);.*/\1/')
LAYERS=$(grep -m1 "^; total layer number" $G | awk '{print $NF}')
VOL=$(grep -m1 "total filament volume" $G | awk '{print $NF}')     # 헤더는 cm^3라 적혀 있지만 실제로는 mm^3
WEIGHT=$(grep -m1 "total filament weight" $G | awk '{print $NF}')
DENS=$(grep -m1 "^; filament_density" $G | awk '{print $NF}')
WARN=$(python3 -c "import json;d=json.load(open('result.json'));print('; '.join(o.get('warning_message') or '' for p in d['sliced_plates'] for o in p['objects']).strip('; '))")
python3 -c "import json;print(json.dumps({'file':'$OUT/$NAME.gcode.3mf','time':'$TIME','layers':int('$LAYERS'),'filament_mm3':float('$VOL'),'filament_g':float('$WEIGHT'),'filament_density':'$DENS','warnings':'$WARN'},ensure_ascii=False))"
