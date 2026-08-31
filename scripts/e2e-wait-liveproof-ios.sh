#!/usr/bin/env bash
# Poll the iOS sidecar for a liveproof reply. Never prints tokens/secrets.
# Usage: e2e-wait-liveproof-ios.sh <udid> <rows> [timeout_sec]
set -euo pipefail
UDID="${1:?udid}"
ROWS="${2:?rows}"
TIMEOUT="${3:-360}"
BUNDLE="${4:-org.name.hypercolor}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CONTAINER="$(xcrun simctl get_app_container "$UDID" "$BUNDLE" data)"
DEST="${CONTAINER}/Documents/hc_e2e_cmd.txt"
xcrun simctl launch "$UDID" "$BUNDLE" >/dev/null 2>&1 || true
sleep 2
"$ROOT/scripts/e2e-run-liveproof-ios.sh" "$UDID" "$ROWS" "$BUNDLE"
deadline=$((SECONDS + TIMEOUT))
while [ "$SECONDS" -lt "$deadline" ]; do
  if [ -f "$DEST" ]; then
    set +e
    python3 - "$DEST" "$ROWS" <<'PY'
import pathlib, re, sys
p = pathlib.Path(sys.argv[1])
rows = sys.argv[2]
try:
    text = p.read_text(errors="replace")
except Exception:
    sys.exit(2)
if not text.startswith("HC_E2E_DONE"):
    sys.exit(2)
text = re.sub(r"[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}", "[TOKEN]", text)
text = re.sub(r"\b[0-9a-fA-F]{32,}\b", "[HEX]", text)
text = re.sub(r"\b[ybndrfg8ejkmcpqxot1uwisza345h769]{52}\b", "[PUBKY]", text)
out = pathlib.Path(f"/tmp/hypercolor-e2e-4601/liveproof-{rows}.txt")
out.write_text(text)
print(f"liveproof_done rows={rows}")
print(text[:4000])
sys.exit(0)
PY
    status=$?
    set -e
    if [ "$status" -eq 0 ]; then
      exit 0
    fi
  fi
  sleep 2
done
echo "liveproof_timeout rows=${ROWS}"
exit 1
