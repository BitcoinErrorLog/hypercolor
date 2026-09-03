#!/usr/bin/env bash
# Capture every iOS VRT scene. Asserts exact `vrt-scene:<id>` before screenshot.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
APP="${APP_ID:-org.name.hypercolor}"
GEN="$ROOT/.maestro/vrt/generated"
OUT="$ROOT/vrt/baselines/ios"
LEDGER_DIR="$ROOT/vrt/output/report"
VIEWPORT_FILTER="${VRT_IOS_VIEWPORT:-}"
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

launch_app_once() {
  local udid="$1"
  local app_path
  app_path="$(find "$HOME/Library/Developer/Xcode/DerivedData" -path '*Debug-iphonesimulator/hypercolor.app' 2>/dev/null | head -1)"
  if [ -n "$app_path" ]; then
    xcrun simctl install "$udid" "$app_path" >/dev/null
  fi
  # Never use openLink on iOS — it leaves a sticky "Open in hypercolor?" sheet.
  xcrun simctl terminate "$udid" "$APP" 2>/dev/null || true
  sleep 1
  xcrun simctl launch "$udid" "$APP" >/dev/null
  sleep 10
  override_status_bar "$udid"
}

echo '{}' > "$PROFILES"
: > /tmp/hc-vrt-ios-asserted.txt
# Capture start time so we only promote PNGs from this run
CAPTURE_START=$(date +%s)

DEVICES="iphone-se-3 iphone-16-pro-max"
if [ -n "$VIEWPORT_FILTER" ]; then
  DEVICES="$VIEWPORT_FILTER"
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

  launch_app_once "$udid"

  shopt -s nullglob
  for flow in "$GEN"/*_ios_"${device}".yaml; do
    scene="$(awk '/^name: VRT /{print $3; exit}' "$flow")"
    echo "==> $scene ($device / $udid)"
    override_status_bar "$udid"
    "$ROOT/scripts/e2e-ios-cmd.sh" "$udid" "$APP" "hypercolor://e2e/vrt?scene=${scene}" || true
    sleep 1
    if maestro --device "$udid" test "$flow"; then
      ok=$((ok + 1))
      echo "${scene}|ios|${device}" >> /tmp/hc-vrt-ios-asserted.txt
    else
      fail=$((fail + 1))
      echo "FAIL $scene" >&2
      # Re-launch if the sim dropped the app
      launch_app_once "$udid"
    fi
  done
done

python3 - "$CAPTURE_START" <<'PY'
from pathlib import Path
import shutil, sys, time
start = int(sys.argv[1])
root = Path.home() / ".maestro" / "tests"
dest = Path("/Users/johncarvalho/work/hypercolor-ux-w3/vrt/baselines/ios")
dest.mkdir(parents=True, exist_ok=True)
# Wipe stale baselines so we never promote prior-run fakes
for old in dest.glob("*.png"):
    old.unlink()
newest = {}
for png in root.rglob("*ios_*.png"):
    if png.stat().st_mtime < start - 5:
        continue
    prev = newest.get(png.name)
    if prev is None or png.stat().st_mtime > prev.stat().st_mtime:
        newest[png.name] = png
for name, png in newest.items():
    shutil.copy2(png, dest / name)
print("ios_baselines", len(list(dest.glob("*.png"))), "updated", len(newest))
PY

python3 - <<'PY'
import json
from pathlib import Path
root = Path("/Users/johncarvalho/work/hypercolor-ux-w3")
asserted = [ln.strip() for ln in Path("/tmp/hc-vrt-ios-asserted.txt").read_text().splitlines() if ln.strip()]
expected = []
for flow in sorted((root / ".maestro/vrt/generated").glob("*_ios_*.yaml")):
    for line in flow.read_text().splitlines():
        if line.startswith("name: VRT "):
            parts = line.split()
            scene = parts[2]
            device = flow.name.split("_ios_")[-1].replace(".yaml", "")
            expected.append(f"{scene}|ios|{device}")
            break
(root / "vrt/output/report/marker-ledger-ios.json").write_text(
    json.dumps({"asserted": asserted, "expected": expected, "okCount": len(asserted)}, indent=2) + "\n"
)
missing = [e for e in expected if e not in set(asserted)]
print("ledger asserted", len(asserted), "expected", len(expected), "missing", len(missing))
if missing:
    raise SystemExit("marker asserts missing: " + ", ".join(missing[:5]))
PY

echo "ios_vrt ok=$ok fail=$fail total=$((ok + fail))"
[ "$fail" -eq 0 ]
[ "$ok" -gt 0 ]
