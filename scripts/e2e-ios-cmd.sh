#!/usr/bin/env bash
# Write HC_E2E:<url> into the iOS Simulator app Documents sidecar.
# Usage: e2e-ios-cmd.sh <udid> <bundle-id> <url>
set -euo pipefail
UDID="${1:?udid}"
BUNDLE="${2:?bundle id}"
URL="${3:?url}"
CONTAINER="$(xcrun simctl get_app_container "$UDID" "$BUNDLE" data)"
DEST="${CONTAINER}/Documents/hc_e2e_cmd.txt"
printf 'HC_E2E:%s' "$URL" > "$DEST"
echo "wrote ${#URL} url-chars"
