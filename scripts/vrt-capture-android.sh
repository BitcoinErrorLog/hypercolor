#!/usr/bin/env bash
# Capture every Android VRT scene on distinct Hypercolor Pixel AVDs
# (Hypercolor_Pixel_4a_API_36 and Hypercolor_Pixel_8_Pro_API_36).
# Scene switch: launch once per viewport, inject HC_E2E AFTER launch, Maestro asserts
# exact `vrt-scene:<id>` BEFORE takeScreenshot.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
APP="${APP_ID:-com.hypercolor}"
ANDROID_HOME="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
ADB="${ANDROID_HOME}/platform-tools/adb"
EMU="${ANDROID_HOME}/emulator/emulator"
BASE_AVD="${VRT_ANDROID_BASE_AVD:-}"

avd_for_device() {
  case "$1" in
    pixel-4a) echo "Hypercolor_Pixel_4a_API_36" ;;
    pixel-8-pro) echo "Hypercolor_Pixel_8_Pro_API_36" ;;
    *) echo "" ;;
  esac
}

serial_for_avd() {
  local want="$1" s name
  for s in $($ADB devices | awk '/emulator/{print $1}'); do
    name="$($ADB -s "$s" emu avd name 2>/dev/null | tr -d '\r' | head -1 || true)"
    if [ "$name" = "$want" ]; then
      echo "$s"
      return 0
    fi
  done
  return 1
}

ensure_emulator() {
  local avd="$1" s boot
  SERIAL="$(serial_for_avd "$avd" || true)"
  if [ -n "${SERIAL:-}" ]; then
    echo "reuse_emulator $SERIAL avd=$avd"
    return 0
  fi
  nohup "$EMU" -avd "$avd" -no-snapshot-load -no-boot-anim -gpu swiftshader_indirect \
    >/tmp/hc-vrt-emu-"$avd".log 2>&1 &
  echo "starting_avd $avd pid=$!"
  for _ in $(seq 1 90); do
    SERIAL="$(serial_for_avd "$avd" || true)"
    if [ -n "${SERIAL:-}" ]; then
      boot="$($ADB -s "$SERIAL" shell getprop sys.boot_completed 2>/dev/null | tr -d '\r' || true)"
      if [ "$boot" = "1" ]; then
        echo "booted SERIAL=$SERIAL avd=$avd"
        return 0
      fi
    fi
    sleep 2
  done
  echo "failed to boot $avd" >&2
  return 1
}

apply_viewport() {
  local device="$1"
  PROFILE_AVD="$(avd_for_device "$device")"
  BASE_AVD="$PROFILE_AVD"
  ensure_emulator "$PROFILE_AVD"
}
VIEWPORT_FILTER="${VRT_ANDROID_VIEWPORT:-}"
GEN="$ROOT/.maestro/vrt/generated"
OUT="$ROOT/vrt/baselines/android"
LEDGER_DIR="$ROOT/vrt/output/report"
PROFILES="$LEDGER_DIR/device-profiles-android.json"
mkdir -p "$OUT" "$LEDGER_DIR"
export PATH="$HOME/.maestro/bin:$PATH"

ok=0
fail=0
SERIAL=""

hide_chrome() {
  "$ADB" -s "$SERIAL" shell settings put global policy_control 'immersive.status=*' || true
  "$ADB" -s "$SERIAL" shell cmd statusbar collapse || true
}

launch_app_once() {
  "$ADB" -s "$SERIAL" reverse tcp:8081 tcp:8081 || true
  local apk="$ROOT/android/app/build/outputs/apk/debug/app-debug.apk"
  if [ -f "$apk" ]; then
    "$ADB" -s "$SERIAL" install -r "$apk" >/dev/null
  fi
  "$ADB" -s "$SERIAL" shell am force-stop "$APP" || true
  "$ADB" -s "$SERIAL" shell monkey -p "$APP" -c android.intent.category.LAUNCHER 1 >/dev/null
  sleep 10
  hide_chrome
}

record_profile() {
  local viewport="$1"
  local size density
  size="$($ADB -s "$SERIAL" shell wm size | tr -d '\r')"
  density="$($ADB -s "$SERIAL" shell wm density | tr -d '\r')"
  python3 - "$PROFILES" "$viewport" "$PROFILE_AVD" "$BASE_AVD" "$SERIAL" "$size" "$density" <<'PY'
import json, sys
from pathlib import Path
path, viewport, profile_avd, base_avd, serial, size, density = sys.argv[1:8]
p = Path(path)
data = json.loads(p.read_text()) if p.exists() else {}
data[viewport] = {
  "profileAvd": profile_avd,
  "baseAvd": base_avd,
  "serial": serial,
  "wmSize": size,
  "wmDensity": density,
  "note": "Distinct Hypercolor_* AVD (not wm override on Medium Phone)",
}
p.write_text(json.dumps(data, indent=2) + "\n")
print("profile", viewport, data[viewport])
PY
}

echo '{}' > "$PROFILES"
: > /tmp/hc-vrt-android-asserted.txt

DEVICES="pixel-4a pixel-8-pro"
if [ -n "$VIEWPORT_FILTER" ]; then
  DEVICES="$VIEWPORT_FILTER"
fi

for device in $DEVICES; do
  apply_viewport "$device"
  record_profile "$device"
  launch_app_once

  shopt -s nullglob
  for flow in "$GEN"/*_android_"${device}".yaml; do
    scene="$(awk '/^name: VRT /{print $3; exit}' "$flow")"
    echo "==> $scene ($device / $SERIAL)"
    hide_chrome
    "$ROOT/scripts/e2e-android-cmd.sh" "$SERIAL" "$APP" "hypercolor://e2e/vrt?scene=${scene}"
    sleep 1
    if maestro --device "$SERIAL" test "$flow"; then
      ok=$((ok + 1))
      echo "${scene}|android|${device}" >> /tmp/hc-vrt-android-asserted.txt
    else
      fail=$((fail + 1))
      echo "FAIL $scene" >&2
    fi
  done
done

# Do not reset wm on the dedicated Pixel AVDs.

python3 - <<'PY'
from pathlib import Path
import shutil
root = Path.home() / ".maestro" / "tests"
dest = Path("/Users/johncarvalho/work/hypercolor-ux-w3/vrt/baselines/android")
dest.mkdir(parents=True, exist_ok=True)
newest = {}
for png in root.rglob("*android_*.png"):
    prev = newest.get(png.name)
    if prev is None or png.stat().st_mtime > prev.stat().st_mtime:
        newest[png.name] = png
for name, png in newest.items():
    shutil.copy2(png, dest / name)
print("android_baselines", len(list(dest.glob("*.png"))), "updated", len(newest))
PY

python3 - <<'PY'
import json
from pathlib import Path
root = Path("/Users/johncarvalho/work/hypercolor-ux-w3")
asserted = [ln.strip() for ln in Path("/tmp/hc-vrt-android-asserted.txt").read_text().splitlines() if ln.strip()]
expected = []
for flow in sorted((root / ".maestro/vrt/generated").glob("*_android_*.yaml")):
    for line in flow.read_text().splitlines():
        if line.startswith("name: VRT "):
            parts = line.split()
            scene = parts[2]
            device = flow.name.split("_android_")[-1].replace(".yaml", "")
            expected.append(f"{scene}|android|{device}")
            break
(root / "vrt/output/report/marker-ledger-android.json").write_text(
    json.dumps({"asserted": asserted, "expected": expected, "okCount": len(asserted)}, indent=2) + "\n"
)
missing = [e for e in expected if e not in set(asserted)]
print("ledger asserted", len(asserted), "expected", len(expected), "missing", len(missing))
if missing:
    raise SystemExit("marker asserts missing: " + ", ".join(missing[:5]))
PY

echo "android_vrt ok=$ok fail=$fail total=$((ok + fail))"
[ "$fail" -eq 0 ]
[ "$ok" -gt 0 ]
