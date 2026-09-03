#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
APP="${APP_ID:-org.name.hypercolor}"
GEN="$ROOT/.maestro/vrt/generated"
ok=0; fail=0
shopt -s nullglob
flows=( "$GEN"/*_ios_*.yaml )
if [ ${#flows[@]} -eq 0 ]; then
  echo "No iOS flows in $GEN" >&2
  exit 1
fi
for flow in "${flows[@]}"; do
  echo "==> $(basename "$flow")"
  if maestro test "$flow"; then ok=$((ok+1)); else fail=$((fail+1)); fi
done
echo "ios_vrt ok=$ok fail=$fail total=$((ok+fail))"
[ "$fail" -eq 0 ]
