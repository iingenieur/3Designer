#!/usr/bin/env python3
"""Bambu Studio 시스템 프로필(leaf)의 `inherits` 체인을 따라가 하나의 JSON으로 평탄화한다.
CLI(--load-settings/--load-filaments)는 inherits를 풀지 않아 밀도·속도 등이 기본값으로 남기 때문이다.
사용법: flatten-profile.py <machine|process|filament> "<프로필 이름>" <출력.json>"""
import json, sys
from pathlib import Path

ROOT = Path("/Applications/BambuStudio.app/Contents/Resources/profiles/BBL")

def load(kind: str, name: str) -> dict:
    path = ROOT / kind / f"{name}.json"
    data = json.loads(path.read_text())
    parent = data.pop("inherits", None)
    merged = load(kind, parent) if parent else {}
    merged.update(data)
    return merged

if __name__ == "__main__":
    kind, name, out = sys.argv[1:4]
    flat = load(kind, name)
    flat.pop("instantiation", None)
    Path(out).write_text(json.dumps(flat, ensure_ascii=False, indent=1))
    print(f"{out}: {len(flat)} keys")
