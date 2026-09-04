#!/usr/bin/env bash
# Write HC_E2E:<url> into the Android app files sidecar.
# The URL never appears on an `am start` command line, so `&` is safe.
# Usage: e2e-android-cmd.sh <serial> <app-id> <url>
set -euo pipefail
SERIAL="${1:?serial}"
APP="${2:?app id}"
URL="${3:?url}"
TMP="$(mktemp)"
cleanup() { rm -f "$TMP"; }
trap cleanup EXIT
printf 'HC_E2E:%s' "$URL" > "$TMP"
adb -s "$SERIAL" push "$TMP" /data/local/tmp/hc_e2e_cmd.txt >/dev/null
adb -s "$SERIAL" shell "run-as $APP mkdir -p files"
# shell user can read /data/local/tmp; run-as cannot. Pipe across the boundary.
adb -s "$SERIAL" shell "cat /data/local/tmp/hc_e2e_cmd.txt | run-as $APP sh -c 'cat > files/hc_e2e_cmd.txt'"
adb -s "$SERIAL" shell "rm -f /data/local/tmp/hc_e2e_cmd.txt"
echo "wrote ${#URL} url-chars"
