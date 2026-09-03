#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
APP="${APP_ID:-com.hypercolor}"
ANDROID_HOME="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
ADB="${ANDROID_HOME}/platform-tools/adb"
SERIAL="${ANDROID_SERIAL:-$($ADB get-serialno)}"
GEN="$ROOT/.maestro/vrt/generated"
ok=0; fail=0
shopt -s nullglob
flows=( "$GEN"/*_android_*.yaml )
if [ ${#flows[@]} -eq 0 ]; then
  echo "No Android flows in $GEN" >&2
  exit 1
fi
for flow in "${flows[@]}"; do
  scene="$(awk '/^name: VRT /{print $3; exit}' "$flow")"
  echo "==> $scene"
  "$ROOT/scripts/e2e-android-cmd.sh" "$SERIAL" "$APP" "hypercolor://e2e/vrt?scene=${scene}"
  if maestro --device "$SERIAL" test "$flow"; then ok=$((ok+1)); else fail=$((fail+1)); echo "FAIL $scene" >&2; fi
done
echo "android_vrt ok=$ok fail=$fail total=$((ok+fail))"
[ "$fail" -eq 0 ]
