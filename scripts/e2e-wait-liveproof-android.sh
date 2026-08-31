#!/usr/bin/env bash
# Poll the Android sidecar for a liveproof reply. Never prints tokens/secrets.
# Usage: e2e-wait-liveproof-android.sh <serial> <rows> [timeout_sec] [app-id]
set -euo pipefail
SERIAL="${1:?serial}"
ROWS="${2:?rows}"
TIMEOUT="${3:-360}"
APP="${4:-com.hypercolor}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
mkdir -p /tmp/hypercolor-e2e-4601
adb -s "$SERIAL" shell "am start -n ${APP}/.MainActivity" >/dev/null 2>&1 || true
# Wait for the DEV channel to claim the sidecar so channel-up cannot
# overwrite the liveproof command, and so leftover DONE is not a pass.
ready_deadline=$((SECONDS + 30))
while [ "$SECONDS" -lt "$ready_deadline" ]; do
  set +e
  ready="$(adb -s "$SERIAL" shell "run-as $APP cat files/hc_e2e_cmd.txt" 2>/dev/null | tr -d '\r')"
  set -e
  case "$ready" in
    HC_E2E_DONE:channel-up*) break ;;
  esac
  sleep 1
done
"$ROOT/scripts/e2e-run-liveproof-android.sh" "$SERIAL" "$ROWS" "$APP"
deadline=$((SECONDS + TIMEOUT))
reply_file="$(mktemp)"
cleanup() { rm -f "$reply_file"; }
trap cleanup EXIT
while [ "$SECONDS" -lt "$deadline" ]; do
  set +e
  adb -s "$SERIAL" shell "run-as $APP cat files/hc_e2e_cmd.txt" >"$reply_file" 2>/dev/null
  status=$?
  set -e
  if [ "$status" -eq 0 ] && [ -s "$reply_file" ]; then
    set +e
    python3 - "$reply_file" "$ROWS" <<'PY'
import pathlib, re, sys
path = pathlib.Path(sys.argv[1])
rows = sys.argv[2]
text = path.read_text(errors="replace").replace("\r", "")
if not text.startswith("HC_E2E_DONE"):
    sys.exit(2)
if text.startswith("HC_E2E_DONE:channel-up"):
    sys.exit(2)
text = re.sub(r"[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}", "[TOKEN]", text)
text = re.sub(r"\b[0-9a-fA-F]{32,}\b", "[HEX]", text)
text = re.sub(r"\b[ybndrfg8ejkmcpqxot1uwisza345h769]{52}\b", "[PUBKY]", text)
out = pathlib.Path(f"/tmp/hypercolor-e2e-4601/liveproof-android-{rows}.txt")
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
    py_status=$?
    set -e
    if [ "$py_status" -eq 0 ]; then
      exit 0
    fi
    if [ "$py_status" -eq 1 ]; then
      echo "liveproof_failed rows=${ROWS}"
      exit 1
    fi
  fi
  sleep 2
done
echo "liveproof_timeout rows=${ROWS}"
exit 1
