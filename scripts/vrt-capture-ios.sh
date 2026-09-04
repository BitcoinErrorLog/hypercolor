#!/usr/bin/env bash
# Capture every iOS VRT scene. Asserts exact `vrt-scene:<id>` before screenshot.
set -euo pipefail
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ROOT="$REPO_ROOT"
APP="${APP_ID:-org.name.hypercolor}"
GEN="$ROOT/.maestro/vrt/generated"
OUT="$ROOT/vrt/baselines/ios"
LEDGER_DIR="$ROOT/vrt/output/report"
VIEWPORT_FILTER="${VRT_IOS_VIEWPORT:-}"
SCENE_FILTER="${VRT_SCENES:-}"
PROFILES="$LEDGER_DIR/device-profiles-ios.json"
mkdir -p "$OUT" "$LEDGER_DIR"
export PATH="$HOME/.maestro/bin:$PATH"

ok=0
fail=0

pick_udid() {
  local device="$1"
  local needle
  case "$device" in
    iphone-se-3) needle='iPhone SE (3rd generation)' ;;
    iphone-16-pro-max) needle='iPhone 16 Pro Max' ;;
    *) echo "" ; return 0 ;;
  esac
  # UUID is always in parentheses as a standalone hex token — not nested name parens.
  xcrun simctl list devices available | grep "$needle" | grep -Eo '[0-9A-Fa-f]{8}-([0-9A-Fa-f]{4}-){3}[0-9A-Fa-f]{12}' | head -1
}

sim_name() {
  case "$1" in
    iphone-se-3) echo "iPhone SE (3rd generation)" ;;
    iphone-16-pro-max) echo "iPhone 16 Pro Max" ;;
    *) echo "$1" ;;
  esac
}

override_status_bar() {
  xcrun simctl status_bar "$1" override \
    --time "09:41" \
    --batteryState charged \
    --batteryLevel 100 \
    --cellularMode active \
    --cellularBars 4 \
    --wifiBars 3 2>/dev/null || true
}

install_app_if_present() {
  local udid="$1"
  local app_path
  app_path="$(
    mdfind "kMDItemFSName == 'hypercolor.app' && kMDItemDisplayName == 'hypercolor'" 2>/dev/null \
      | grep 'Debug-iphonesimulator/hypercolor.app$' \
      | head -1 || true
  )"
  if [ -z "$app_path" ]; then
    app_path="$(ls -d "$HOME"/Library/Developer/Xcode/DerivedData/hypercolor-*/Build/Products/Debug-iphonesimulator/hypercolor.app 2>/dev/null | head -1 || true)"
  fi
  if [ -n "$app_path" ]; then
    echo "installing $app_path"
    xcrun simctl install "$udid" "$app_path" >/dev/null || echo "install_warn $?"
  else
    echo "warning: hypercolor.app not found; assuming already installed on $udid" >&2
  fi
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

launch_app() {
  local udid="$1"
  # Never use openLink on iOS — it leaves a sticky "Open in hypercolor?" sheet.
  xcrun simctl terminate "$udid" "$APP" 2>/dev/null || true
  sleep 1
  xcrun simctl launch "$udid" "$APP" >/dev/null
  sleep 8
  override_status_bar "$udid"
}

set_font_scale_for_scene() {
  local udid="$1"
  local scene="$2"
  if [ "$scene" = "a11y.font-scale.two" ]; then
    xcrun simctl ui "$udid" content_size accessibility-extra-extra-extra-large 2>/dev/null || true
  else
    xcrun simctl ui "$udid" content_size large 2>/dev/null || true
  fi
}

echo '{}' > "$PROFILES"
if [ -z "${VRT_IOS_KEEP_BOOTED:-}" ]; then
  : > /tmp/hc-vrt-ios-asserted.txt
fi
# Capture start time so we only promote PNGs from this run
CAPTURE_START=$(date +%s)

DEVICES="iphone-se-3 iphone-16-pro-max"
if [ -n "$VIEWPORT_FILTER" ]; then
  DEVICES="$VIEWPORT_FILTER"
fi

if [ -z "${VRT_IOS_KEEP_BOOTED:-}" ] || [ ! -s /tmp/hc-vrt-ios-asserted.txt ]; then
  for device in $DEVICES; do
    if [ -n "$SCENE_FILTER" ]; then
      for scene in ${SCENE_FILTER//,/ }; do
        rm -f "$OUT"/"${scene//./_}"_ios_"${device}".png
      done
    else
      rm -f "$OUT"/*_ios_"${device}".png
    fi
  done
fi

for device in $DEVICES; do
  udid="$(pick_udid "$device")"
  if [ -z "$udid" ]; then
    echo "No simulator for $device" >&2
    exit 1
  fi
  echo "udid $device -> $udid"
  xcrun simctl boot "$udid" 2>/dev/null || true
  override_status_bar "$udid"
  python3 - "$PROFILES" "$device" "$udid" "$(sim_name "$device")" <<'PY'
import json, sys
from pathlib import Path
path, viewport, udid, name = sys.argv[1:5]
p = Path(path)
data = json.loads(p.read_text()) if p.exists() else {}
data[viewport] = {"udid": udid, "simulator": name}
p.write_text(json.dumps(data, indent=2) + "\n")
print("profile", viewport, data[viewport])
PY

  xcrun simctl terminate "$udid" "$APP" 2>/dev/null || true
  install_app_if_present "$udid"
  launch_app "$udid"

  shopt -s nullglob
  for flow in "$GEN"/*_ios_"${device}".yaml; do
    scene="$(awk '/^name: VRT /{print $3; exit}' "$flow")"
    if ! scene_selected "$scene"; then
      continue
    fi
    if grep -qx "${scene}|ios|${device}" /tmp/hc-vrt-ios-asserted.txt 2>/dev/null; then
      echo "skip $scene ($device already asserted)"
      ok=$((ok + 1))
      continue
    fi
    echo "==> $scene ($device / $udid)"
    scene_ok=0
    for attempt in 1 2 3; do
      override_status_bar "$udid"
      set_font_scale_for_scene "$udid" "$scene"
      "$ROOT/scripts/e2e-ios-cmd.sh" "$udid" "$APP" "hypercolor://e2e/vrt?scene=${scene}" || true
      sleep 2
      if maestro --device "$udid" test "$flow"; then
        scene_ok=1
        break
      fi
      echo "retry $attempt $scene" >&2
      sleep 4
      if [ "$attempt" -eq 2 ]; then
        launch_app "$udid"
      fi
    done
    set_font_scale_for_scene "$udid" default
    if [ "$scene_ok" -eq 1 ]; then
      ok=$((ok + 1))
      echo "${scene}|ios|${device}" >> /tmp/hc-vrt-ios-asserted.txt
      python3 - "$ROOT" "$scene" "$device" <<'PY'
from pathlib import Path
import shutil, sys
repo = Path(sys.argv[1])
scene, device = sys.argv[2], sys.argv[3]
needle = scene.replace(".", "_") + f"_ios_{device}.png"
root = Path.home() / ".maestro" / "tests"
dest = repo / "vrt/baselines/ios"
dest.mkdir(parents=True, exist_ok=True)
newest = None
for png in root.rglob(needle):
    if newest is None or png.stat().st_mtime > newest.stat().st_mtime:
        newest = png
if newest:
    shutil.copy2(newest, dest / newest.name)
    print("copied", newest.name)
PY
    else
      fail=$((fail + 1))
      echo "FAIL $scene" >&2
    fi
  done
  if [ -z "${VRT_IOS_KEEP_BOOTED:-}" ]; then
    set_font_scale_for_scene "$udid" default
    echo "shutdown $device $udid"
    xcrun simctl shutdown "$udid" 2>/dev/null || true
  fi
done

python3 - "$ROOT" "$CAPTURE_START" "$DEVICES" "$SCENE_FILTER" <<'PY'
from pathlib import Path
import shutil, sys
repo = Path(sys.argv[1])
start = int(sys.argv[2])
devices = sys.argv[3].split()
scenes = set(sys.argv[4].replace(",", " ").split())
root = Path.home() / ".maestro" / "tests"
dest = repo / "vrt/baselines/ios"
dest.mkdir(parents=True, exist_ok=True)
newest = {}
for png in root.rglob("*ios_*.png"):
    if png.stat().st_mtime < start - 5:
        continue
    if not any(png.name.endswith(f"_ios_{d}.png") for d in devices):
        continue
    if scenes and png.name.rsplit("_ios_", 1)[0].replace("_", ".") not in scenes:
        continue
    prev = newest.get(png.name)
    if prev is None or png.stat().st_mtime > prev.stat().st_mtime:
        newest[png.name] = png
for name, png in newest.items():
    shutil.copy2(png, dest / name)
print("ios_baselines", len(list(dest.glob("*.png"))), "updated", len(newest))
PY

python3 - "$ROOT" "$DEVICES" "$SCENE_FILTER" <<'PY'
import json, sys
from pathlib import Path
root = Path(sys.argv[1])
devices = set(sys.argv[2].split())
scenes = set(sys.argv[3].replace(",", " ").split())
asserted = [ln.strip() for ln in Path("/tmp/hc-vrt-ios-asserted.txt").read_text().splitlines() if ln.strip()]
ledger_path = root / "vrt/output/report/marker-ledger-ios.json"
prior = []
if ledger_path.exists():
    try:
        prior = json.loads(ledger_path.read_text()).get("asserted") or []
    except Exception:
        prior = []
kept = [a for a in prior if a.split("|")[-1] not in devices]
asserted = kept + asserted
expected = []
for flow in sorted((root / ".maestro/vrt/generated").glob("*_ios_*.yaml")):
    for line in flow.read_text().splitlines():
        if line.startswith("name: VRT "):
            parts = line.split()
            scene = parts[2]
            device = flow.name.split("_ios_")[-1].replace(".yaml", "")
            if scenes and scene not in scenes:
                continue
            expected.append(f"{scene}|ios|{device}")
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

echo "ios_vrt ok=$ok fail=$fail total=$((ok + fail))"
[ "$fail" -eq 0 ]
[ "$ok" -gt 0 ]
