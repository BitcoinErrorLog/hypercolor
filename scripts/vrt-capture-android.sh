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
SCENE_FILTER="${VRT_SCENES:-}"
GEN="$ROOT/.maestro/vrt/generated"
OUT="$ROOT/vrt/baselines/android"
LEDGER_DIR="$ROOT/vrt/output/report"
PROFILES="$LEDGER_DIR/device-profiles-android.json"
mkdir -p "$OUT" "$LEDGER_DIR"
export PATH="$ANDROID_HOME/platform-tools:$HOME/.maestro/bin:$PATH"

ok=0
fail=0
SERIAL=""

hide_chrome() {
  "$ADB" -s "$SERIAL" shell pm disable-user --user 0 com.google.android.apps.wellbeing >/dev/null 2>&1 || true
  "$ADB" -s "$SERIAL" shell settings put global policy_control 'immersive.status=*' || true
  "$ADB" -s "$SERIAL" shell cmd statusbar collapse || true
}

scene_selected() {
  local scene="$1"
  if [ -z "$SCENE_FILTER" ]; then
    return 0
  fi
  case " ${SCENE_FILTER//,/ } " in
    *" $scene "*) return 0 ;;
    *) return 1 ;;
  esac
}

set_font_scale_for_scene() {
  local scene="$1"
  if [ "$scene" = "a11y.font-scale.two" ]; then
    "$ADB" -s "$SERIAL" shell settings put system font_scale 2.0 || true
  else
    "$ADB" -s "$SERIAL" shell settings put system font_scale 1.0 || true
  fi
  "$ADB" -s "$SERIAL" shell am broadcast -a android.intent.action.CLOSE_SYSTEM_DIALOGS >/dev/null 2>&1 || true
  sleep 5
  hide_chrome
}

launch_app_once() {
  "$ADB" -s "$SERIAL" reverse tcp:8081 tcp:8081 || true
  local apk="$ROOT/android/app/build/outputs/apk/debug/app-debug.apk"
  if [ -f "$apk" ] && [ "${VRT_ANDROID_SKIP_INSTALL:-}" != "1" ]; then
    "$ADB" -s "$SERIAL" install -r "$apk" >/dev/null
  fi
  "$ADB" -s "$SERIAL" shell am force-stop "$APP" || true
  "$ADB" -s "$SERIAL" shell "run-as $APP rm -f files/BridgelessReactNativeDevBundle.js files/hc_e2e_cmd.txt" >/dev/null 2>&1 || true
  local activity
  activity="$("$ADB" -s "$SERIAL" shell cmd package resolve-activity --brief "$APP" 2>/dev/null | awk '/\//{print; exit}' | tr -d '\r' || true)"
  if [ -n "$activity" ]; then
    "$ADB" -s "$SERIAL" shell am start -n "$activity" >/dev/null 2>&1 || true
  fi
  for _ in $(seq 1 30); do
    local focus
    focus="$("$ADB" -s "$SERIAL" shell dumpsys window 2>/dev/null | awk '/mCurrentFocus|mFocusedApp|topResumedActivity/{print; exit}' || true)"
    if [[ "$focus" == *"$APP"* ]]; then
      break
    fi
    sleep 1
  done
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
CAPTURE_START=$(date +%s)

DEVICES="pixel-4a pixel-8-pro"
if [ -n "$VIEWPORT_FILTER" ]; then
  DEVICES="$VIEWPORT_FILTER"
fi

for device in $DEVICES; do
  apply_viewport "$device"
  if [ -n "${VRT_ANDROID_SETTLE_SECONDS:-}" ]; then
    sleep "$VRT_ANDROID_SETTLE_SECONDS"
  fi
  record_profile "$device"
  launch_app_once

  shopt -s nullglob
  for flow in "$GEN"/*_android_"${device}".yaml; do
    scene="$(awk '/^name: VRT /{print $3; exit}' "$flow")"
    if ! scene_selected "$scene"; then
      continue
    fi
    echo "==> $scene ($device / $SERIAL)"
    scene_ok=0
    for attempt in 1 2 3; do
      hide_chrome
      set_font_scale_for_scene "$scene"
      "$ROOT/scripts/e2e-android-cmd.sh" "$SERIAL" "$APP" "hypercolor://e2e/vrt?scene=${scene}"
      sleep 1
      if maestro --device "$SERIAL" test "$flow"; then
        scene_ok=1
        break
      fi
      echo "retry $attempt $scene" >&2
      sleep 4
      if [ "$attempt" -eq 2 ]; then
        launch_app_once
      fi
    done
    set_font_scale_for_scene "default"
    if [ "$scene_ok" -eq 1 ]; then
      ok=$((ok + 1))
      echo "${scene}|android|${device}" >> /tmp/hc-vrt-android-asserted.txt
    else
      fail=$((fail + 1))
      echo "FAIL $scene" >&2
    fi
  done
  if [ -z "${VRT_ANDROID_KEEP_BOOTED:-}" ]; then
    echo "killing_avd $PROFILE_AVD SERIAL=$SERIAL"
    "$ADB" -s "$SERIAL" emu kill 2>/dev/null || true
    sleep 3
    SERIAL=""
  else
    echo "keeping_avd $PROFILE_AVD SERIAL=$SERIAL"
  fi
done

# Do not reset wm on the dedicated Pixel AVDs.

python3 - "$CAPTURE_START" "$DEVICES" "$SCENE_FILTER" <<'PY'
from pathlib import Path
import shutil, sys
start = int(sys.argv[1])
devices = sys.argv[2].split()
scenes = set(sys.argv[3].replace(",", " ").split())
root = Path.home() / ".maestro" / "tests"
dest = Path("/Users/johncarvalho/work/hypercolor-ux-w3/vrt/baselines/android")
dest.mkdir(parents=True, exist_ok=True)
for device in devices:
    if scenes:
        for scene in scenes:
            old = dest / f"{scene.replace('.', '_')}_android_{device}.png"
            if old.exists():
                old.unlink()
    else:
        for old in dest.glob(f"*_android_{device}.png"):
            old.unlink()
newest = {}
for png in root.rglob("*android_*.png"):
    if png.stat().st_mtime < start - 5:
        continue
    if not any(png.name.endswith(f"_android_{d}.png") for d in devices):
        continue
    if scenes and png.name.rsplit("_android_", 1)[0].replace("_", ".") not in scenes:
        continue
    prev = newest.get(png.name)
    if prev is None or png.stat().st_mtime > prev.stat().st_mtime:
        newest[png.name] = png
for name, png in newest.items():
    shutil.copy2(png, dest / name)
print("android_baselines", len(list(dest.glob("*.png"))), "updated", len(newest))
PY

python3 - "$DEVICES" "$SCENE_FILTER" <<'PY'
import json, sys
from pathlib import Path
root = Path("/Users/johncarvalho/work/hypercolor-ux-w3")
devices = set(sys.argv[1].split())
scenes = set(sys.argv[2].replace(",", " ").split())
asserted = [ln.strip() for ln in Path("/tmp/hc-vrt-android-asserted.txt").read_text().splitlines() if ln.strip()]
ledger_path = root / "vrt/output/report/marker-ledger-android.json"
prior = []
if ledger_path.exists():
    try:
        prior = json.loads(ledger_path.read_text()).get("asserted") or []
    except Exception:
        prior = []
kept = [a for a in prior if a.split("|")[-1] not in devices]
asserted = kept + asserted
expected = []
for flow in sorted((root / ".maestro/vrt/generated").glob("*_android_*.yaml")):
    for line in flow.read_text().splitlines():
        if line.startswith("name: VRT "):
            parts = line.split()
            scene = parts[2]
            device = flow.name.split("_android_")[-1].replace(".yaml", "")
            if scenes and scene not in scenes:
                continue
            expected.append(f"{scene}|android|{device}")
            break
ledger_path.write_text(
    json.dumps({"asserted": asserted, "expected": expected, "okCount": len(asserted)}, indent=2) + "\n"
)
run_expected = [e for e in expected if e.split("|")[-1] in devices]
missing = [e for e in run_expected if e not in set(asserted)]
print("ledger asserted", len(asserted), "expected", len(expected), "this_run", len(run_expected), "missing", len(missing))
if missing:
    raise SystemExit("marker asserts missing: " + ", ".join(missing[:5]))
PY

echo "android_vrt ok=$ok fail=$fail total=$((ok + fail))"
[ "$fail" -eq 0 ]
[ "$ok" -gt 0 ]
