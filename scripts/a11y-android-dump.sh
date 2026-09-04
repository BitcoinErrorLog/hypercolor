#!/usr/bin/env bash
# Dump Android VRT scenes and check 44dp + content-desc on clickable product nodes.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
APP="${APP_ID:-com.hypercolor}"
ANDROID_HOME="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
ADB="${ANDROID_HOME}/platform-tools/adb"
SERIAL="${ANDROID_SERIAL:-}"
PROFILE="${A11Y_PROFILE:-}"
SCENES="${A11Y_SCENES:-auth.welcome.idle auth.enable.authorizing tabs.chats.populated stack.thread.populated tabs.settings.default}"
KNOWN_CONTROL_SCENES="${A11Y_KNOWN_CONTROL_SCENES:-$SCENES}"
OUT_DIR="${A11Y_DUMP_DIR:-$ROOT/vrt/output/report/a11y-dumps}"
REPORT_DIR="$ROOT/vrt/output/report"

if [ -z "$SERIAL" ]; then
  SERIAL="$($ADB devices | awk '/emulator/{print $1; exit}')"
fi
if [ -z "$SERIAL" ]; then
  echo "No Android emulator serial found" >&2
  exit 2
fi
if [ -z "$PROFILE" ]; then
  PROFILE="$($ADB -s "$SERIAL" emu avd name 2>/dev/null | tr -d '\r' | sed 's/^Hypercolor_Pixel_//; s/_API_36$//; s/_/-/g; y/ABCDEFGHIJKLMNOPQRSTUVWXYZ/abcdefghijklmnopqrstuvwxyz/' | head -1 || true)"
fi
if [ -z "$PROFILE" ]; then
  PROFILE="android"
fi
if [ -n "${A11Y_SETTLE_SECONDS:-}" ]; then
  sleep "$A11Y_SETTLE_SECONDS"
fi

mkdir -p "$OUT_DIR" "$REPORT_DIR"
JSONL="$REPORT_DIR/a11y-android-${PROFILE}.jsonl"
: > "$JSONL"
export PATH="$ANDROID_HOME/platform-tools:$PATH"

is_known_control_scene() {
  local scene="$1"
  case " ${KNOWN_CONTROL_SCENES//,/ } " in
    *" $scene "*) return 0 ;;
    *) return 1 ;;
  esac
}

hide_chrome() {
  "$ADB" -s "$SERIAL" shell settings put global policy_control 'immersive.full=*' >/dev/null 2>&1 || true
  "$ADB" -s "$SERIAL" shell cmd statusbar collapse >/dev/null 2>&1 || true
}

switch_scene() {
  local scene="$1"
  "$ROOT/scripts/e2e-android-cmd.sh" "$SERIAL" "$APP" "hypercolor://e2e/vrt?scene=${scene}" >/dev/null
  sleep "${A11Y_SCENE_SETTLE_SECONDS:-2}"
}

launch_app_once() {
  local bundle="/tmp/hc-android-vrt-bundle.js"
  local apk="$ROOT/android/app/build/outputs/apk/debug/app-debug.apk"
  if [ "${A11Y_INSTALL:-0}" = "1" ] && [ -f "$apk" ]; then
    "$ADB" -s "$SERIAL" install -r "$apk" >/dev/null
  fi
  "$ADB" -s "$SERIAL" reverse tcp:8081 tcp:8081 >/dev/null 2>&1 || true
  "$ADB" -s "$SERIAL" shell am force-stop "$APP" >/dev/null 2>&1 || true
  "$ADB" -s "$SERIAL" shell "run-as $APP rm -f files/hc_e2e_cmd.txt" >/dev/null 2>&1 || true
  cat >/tmp/hc-vrt-devsettings.xml <<'XML'
<?xml version='1.0' encoding='utf-8' standalone='yes' ?>
<map>
    <string name="debug_http_host">localhost:8081</string>
</map>
XML
  "$ADB" -s "$SERIAL" push /tmp/hc-vrt-devsettings.xml /data/local/tmp/hc-vrt-devsettings.xml >/dev/null
  "$ADB" -s "$SERIAL" shell "run-as $APP mkdir -p shared_prefs && cat /data/local/tmp/hc-vrt-devsettings.xml | run-as $APP sh -c 'cat > shared_prefs/com.facebook.react.devsupport.DevSettingsActivity.xml'"
  "$ADB" -s "$SERIAL" shell rm -f /data/local/tmp/hc-vrt-devsettings.xml
  if [ "${A11Y_INJECT_BUNDLE:-}" = "1" ]; then
    python3 - "$bundle" <<'PY'
import sys
import urllib.request

bundle_path = sys.argv[1]
url = "http://127.0.0.1:8081/index.bundle?platform=android&dev=true&minify=false"
data = urllib.request.urlopen(url, timeout=90).read()
if b"vrt-scene" not in data:
    raise SystemExit("Metro bundle does not contain vrt-scene")
open(bundle_path, "wb").write(data)
print("bundle_bytes", len(data), "contains_vrt_scene", True)
PY
    "$ADB" -s "$SERIAL" push "$bundle" /data/local/tmp/BridgelessReactNativeDevBundle.js >/dev/null
    "$ADB" -s "$SERIAL" shell "run-as $APP mkdir -p files && cat /data/local/tmp/BridgelessReactNativeDevBundle.js | run-as $APP sh -c 'cat > files/BridgelessReactNativeDevBundle.js'"
    "$ADB" -s "$SERIAL" shell rm -f /data/local/tmp/BridgelessReactNativeDevBundle.js
  fi
  local activity
  activity="$("$ADB" -s "$SERIAL" shell cmd package resolve-activity --brief "$APP" 2>/dev/null | awk '/\//{print; exit}' | tr -d '\r' || true)"
  if [ -n "$activity" ]; then
    "$ADB" -s "$SERIAL" shell am start -n "$activity" >/dev/null
  fi
  for _ in $(seq 1 30); do
    local focus
    focus="$("$ADB" -s "$SERIAL" shell dumpsys window 2>/dev/null | awk '/mCurrentFocus|mFocusedApp|topResumedActivity/{print; exit}' || true)"
    if [[ "$focus" == *"$APP"* ]]; then
      break
    fi
    sleep 1
  done
}

dump_scene() {
  local scene="$1"
  local safe="${scene//./_}_android_${PROFILE}.xml"
  local path="$OUT_DIR/$safe"
  local raw density status=0
  density="$($ADB -s "$SERIAL" shell wm density 2>/dev/null | tr -d '\r' | awk '/Physical density/{print $3; exit}')"
  density="${density:-440}"

  "$ADB" -s "$SERIAL" shell rm -f /sdcard/window_dump.xml >/dev/null 2>&1 || true
  raw="$($ADB -s "$SERIAL" shell uiautomator dump /sdcard/window_dump.xml 2>&1)" || status=$?
  if [ "$status" -eq 0 ] && [[ "$raw" != *"UI hierchary dumped"* ]] && [[ "$raw" != *"UI hierarchy dumped"* ]]; then
    status=1
  fi
  if ! "$ADB" -s "$SERIAL" exec-out cat /sdcard/window_dump.xml > "$path" 2>/tmp/hc-a11y-cat.err; then
    cat /tmp/hc-a11y-cat.err > "$path"
    status=1
  fi

  python3 - "$scene" "$path" "$JSONL" "$status" "$raw" "$(is_known_control_scene "$scene" && echo 1 || echo 0)" "$density" <<'PY'
import html
import json
import re
import sys
from pathlib import Path

scene, dump_path, jsonl_path, dump_status, raw, known_controls, density_arg = sys.argv[1:8]
path = Path(dump_path)
xml = path.read_text(errors="replace") if path.exists() else ""
density = int(density_arg)

fail = []
ok = 0
status = "ok"
nodes = re.findall(r"<node [^>]+>", xml) if xml.lstrip().startswith("<?xml") else []
clickable = [n for n in nodes if 'clickable="true"' in n]

if int(dump_status) != 0 or not path.exists() or not xml.lstrip().startswith("<?xml"):
    status = "fail"
    fail.append({"reason": "missing-or-invalid-dump", "raw": raw.strip()[:240] or xml.strip()[:240]})
elif "rn_redbox" in xml or "Unable to load script" in xml:
    status = "fail"
    fail.append({"reason": "react-native-redbox"})

for node in clickable:
    desc = html.unescape((re.search(r'content-desc="([^"]*)"', node) or ["", ""])[1])
    bounds = re.search(r'bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"', node)
    if not bounds:
        fail.append({"reason": "missing-bounds", "node": node[:240]})
        continue
    x1, y1, x2, y2 = map(int, bounds.groups())
    w = (x2 - x1) * 160 / density
    h = (y2 - y1) * 160 / density
    if w < 44 or h < 44 or not desc:
        fail.append({
            "reason": "clickable-a11y",
            "bounds": [x1, y1, x2, y2],
            "dp": [round(w, 1), round(h, 1)],
            "desc": desc,
        })
    else:
        ok += 1

if known_controls == "1" and len(clickable) == 0:
    status = "fail"
    fail.append({"reason": "zero-clickable-controls"})
elif fail:
    status = "fail"

result = {
    "scene": scene,
    "profile": Path(dump_path).stem.rsplit("_android_", 1)[-1],
    "status": status,
    "clickable": len(clickable),
    "ok": ok,
    "fail": fail[:20],
    "dump": dump_path,
}
with open(jsonl_path, "a", encoding="utf-8") as fh:
    fh.write(json.dumps(result, sort_keys=True) + "\n")
print(json.dumps(result, indent=2))
sys.exit(1 if status == "fail" else 0)
PY
}

failures=0
launch_app_once
if [ -n "${A11Y_APP_SETTLE_SECONDS:-}" ]; then
  sleep "$A11Y_APP_SETTLE_SECONDS"
fi
hide_chrome
for scene in ${SCENES//,/ }; do
  echo "==> a11y $scene ($PROFILE / $SERIAL)"
  switch_scene "$scene"
  hide_chrome
  if ! dump_scene "$scene"; then
    failures=$((failures + 1))
  fi
done

python3 - "$JSONL" <<'PY'
import json
import sys
from pathlib import Path
rows = [json.loads(line) for line in Path(sys.argv[1]).read_text().splitlines() if line.strip()]
print(json.dumps({
    "profile": rows[0]["profile"] if rows else "unknown",
    "scenes": len(rows),
    "status_ok": sum(1 for row in rows if row["status"] == "ok"),
    "status_fail": sum(1 for row in rows if row["status"] == "fail"),
    "clickable": sum(row["clickable"] for row in rows),
    "ok": sum(row["ok"] for row in rows),
    "fail": sum(len(row["fail"]) for row in rows),
}, indent=2))
PY

exit "$failures"
