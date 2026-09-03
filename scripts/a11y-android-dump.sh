#!/usr/bin/env bash
# Dump the current focused Android window and check 44dp + content-desc on clickable nodes.
set -euo pipefail
ANDROID_HOME="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
ADB="${ANDROID_HOME}/platform-tools/adb"
SERIAL="${ANDROID_SERIAL:-}"
if [ -z "$SERIAL" ]; then
  SERIAL="$($ADB devices | awk '/emulator/{print $1; exit}')"
fi
DUMP="/tmp/hc-a11y-window.xml"
$ADB -s "$SERIAL" shell uiautomator dump /sdcard/window_dump.xml >/dev/null
$ADB -s "$SERIAL" exec-out cat /sdcard/window_dump.xml > "$DUMP"
python3 - "$DUMP" <<'PY'
import json, re, sys
from pathlib import Path
xml = Path(sys.argv[1]).read_text(errors="replace")
# density: 440 for pixel-4a fallback
density = 440
nodes = re.findall(r"<node [^>]+>", xml)
clickable = [n for n in nodes if 'clickable="true"' in n]
fail = []
ok = 0
for n in clickable:
    desc = re.search(r'content-desc="([^"]*)"', n)
    bounds = re.search(r'bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"', n)
    if not bounds:
        fail.append("missing-bounds")
        continue
    x1,y1,x2,y2 = map(int, bounds.groups())
    w = (x2-x1) * 160 / density
    h = (y2-y1) * 160 / density
    label = desc.group(1) if desc else ""
    if w < 44 or h < 44 or not label:
        fail.append({"bounds": [x1,y1,x2,y2], "dp": [w,h], "desc": label})
    else:
        ok += 1
print(json.dumps({"clickable": len(clickable), "ok": ok, "fail": fail[:20]}, indent=2))
if fail:
    sys.exit(1)
PY
