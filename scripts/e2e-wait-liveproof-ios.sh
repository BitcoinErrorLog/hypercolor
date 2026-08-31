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
# Wait for the DEV channel so channel-up cannot overwrite the command.
ready_deadline=$((SECONDS + 30))
while [ "$SECONDS" -lt "$ready_deadline" ]; do
  if [ -f "$DEST" ]; then
    ready="$(tr -d '\r' < "$DEST" 2>/dev/null || true)"
    case "$ready" in
      HC_E2E_DONE:channel-up*) break ;;
    esac
  fi
  sleep 1
done
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
if text.startswith("HC_E2E_DONE:channel-up"):
    sys.exit(2)
text = re.sub(r"[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}", "[TOKEN]", text)
text = re.sub(r"\b[0-9a-fA-F]{32,}\b", "[HEX]", text)
text = re.sub(r"\b[ybndrfg8ejkmcpqxot1uwisza345h769]{52}\b", "[PUBKY]", text)
out = pathlib.Path(f"/tmp/hypercolor-e2e-4601/liveproof-{rows}.txt")
out.write_text(text)
print(f"liveproof_done rows={rows}")
print(text[:4000])
payload = text.split(":", 1)[1] if text.startswith("HC_E2E_DONE:") and len(text) > 12 else ""
if payload.startswith("{"):
    import json
    try:
        data = json.loads(payload)
    except json.JSONDecodeError:
        sys.exit(1)
    if data.get("ok") is not True:
        sys.exit(1)
    rows_out = data.get("rows") or []
    if not rows_out or any(entry.get("ok") is not True for entry in rows_out):
        sys.exit(1)
sys.exit(0)
PY
    status=$?
    set -e
    if [ "$status" -eq 0 ]; then
      exit 0
    fi
    if [ "$status" -eq 1 ]; then
      echo "liveproof_failed rows=${ROWS}"
      exit 1
    fi
  fi
  sleep 2
done
echo "liveproof_timeout rows=${ROWS}"
exit 1
