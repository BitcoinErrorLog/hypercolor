#!/usr/bin/env bash
# Mint staging tokens (never echoed) and send hypercolor://e2e/liveproof
# through the iOS Simulator Documents sidecar. Usage:
#   e2e-run-liveproof-ios.sh <udid> <rows>
# rows example: p0  or  p0,p2,p3,p5,tips
set -euo pipefail
UDID="${1:?udid}"
ROWS="${2:-p0}"
BUNDLE="${3:-org.name.hypercolor}"
HS="${HOMESERVER_PUBKY:-ufibwbmed6jeq9k4p583go95wofakh9fwpp4k734trq79pd9u1uy}"
GEN="${GENERATE_SCRIPT:-$HOME/.cursor/skills/pubky-staging-invite/scripts/generate.sh}"
need=2
case ",$ROWS," in
  *",p1,"*|*",p2,"*) need=3 ;;
esac
TOKENS=()
i=0
while [ "$i" -lt "$need" ]; do
  TOKENS+=("$(bash "$GEN")")
  i=$((i + 1))
done
URL="hypercolor://e2e/liveproof?homeserver=${HS}&tokenA=${TOKENS[0]}&tokenB=${TOKENS[1]}&rows=${ROWS}"
if [ "$need" -ge 3 ]; then
  URL="${URL}&tokenC=${TOKENS[2]}"
fi
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
"$ROOT/scripts/e2e-ios-cmd.sh" "$UDID" "$BUNDLE" "$URL"
echo "liveproof_sent rows=${ROWS} tokens=${need}"
