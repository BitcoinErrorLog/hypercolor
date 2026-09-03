#!/usr/bin/env bash
# Capture every Android VRT scene.
# Distinct viewports: apply genuine wm size/density for pixel-4a vs pixel-8-pro
# on a booted emulator (AVD configs Hypercolor_Pixel_* exist; live wm matches matrix).
# Scene switch: launch once per viewport, inject HC_E2E AFTER launch, Maestro asserts
# exact `vrt-scene:<id>` BEFORE takeScreenshot.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
APP="${APP_ID:-com.hypercolor}"
ANDROID_HOME="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
ADB="${ANDROID_HOME}/platform-tools/adb"
EMU="${ANDROID_HOME}/emulator/emulator"
BASE_AVD="${VRT_ANDROID_BASE_AVD:-Medium_Phone_API_36.1}"
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

ensure_emulator() {
  local s boot
  for s in $($ADB devices | awk '/emulator/{print $1}'); do
    if $ADB -s "$s" shell getprop sys.boot_completed 2>/dev/null | tr -d '\r' | grep -q 1; then
      SERIAL="$s"
      echo "reuse_emulator $SERIAL"
      return 0
    fi
  done
  nohup "$EMU" -avd "$BASE_AVD" -no-snapshot-load -no-boot-anim -gpu swiftshader_indirect \
    >/tmp/hc-vrt-emu-base.log 2>&1 &
  echo "starting_avd $BASE_AVD pid=$!"
  for _ in $(seq 1 90); do
    for s in $($ADB devices | awk '/emulator/{print $1}'); do
      boot="$($ADB -s "$s" shell getprop sys.boot_completed 2>/dev/null | tr -d '\r' || true)"
      if [ "$boot" = "1" ]; then
        SERIAL="$s"
        echo "booted SERIAL=$SERIAL avd=$BASE_AVD"
        return 0
      fi
    done
    sleep 2
  done
  echo "failed to boot $BASE_AVD" >&2
  return 1
}

apply_viewport() {
  local device="$1"
  case "$device" in
    pixel-4a)
      "$ADB" -s "$SERIAL" shell wm size 1080x2340
      "$ADB" -s "$SERIAL" shell wm density 440
      PROFILE_AVD="Hypercolor_Pixel_4a_API_36"
      ;;
    pixel-8-pro)
      "$ADB" -s "$SERIAL" shell wm size 1344x2992
      "$ADB" -s "$SERIAL" shell wm density 480
      PROFILE_AVD="Hypercolor_Pixel_8_Pro_API_36"
      ;;
    *) echo "unknown device $device" >&2; return 1 ;;
  esac
  sleep 2
}

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
  "note": "Live wm size/density match Hypercolor_* AVD lcd specs on shared base AVD",
}
p.write_text(json.dumps(data, indent=2) + "\n")
print("profile", viewport, data[viewport])
PY
}

echo '{}' > "$PROFILES"
: > /tmp/hc-vrt-android-asserted.txt
ensure_emulator

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

# Reset display
"$ADB" -s "$SERIAL" shell wm size reset || true
"$ADB" -s "$SERIAL" shell wm density reset || true

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
