#!/usr/bin/env bash
# Runs the browser checks against a real hub process serving the built web app (see README.md).
#   npm run build && npm run browser          (needs: node, python3 with numpy + cryptography, curl, playwright)
# WEB_DIR picks another build folder (default dist). SCR is where screenshots and logs go (default tests/browser/out).
set -euo pipefail
cd "$(dirname "$0")/../.."

WEB="${WEB_DIR:-dist}"
PORT=8799
export SCR="${SCR:-$PWD/tests/browser/out}"
[ -f "$WEB/index.html" ] || { echo "No built web app in $WEB. Run: npm run build" >&2; exit 1; }
WEB="$(cd "$WEB" && pwd)"
mkdir -p "$SCR"
HUB_PID=""

stop_hub() {
  if [ -n "$HUB_PID" ]; then kill "$HUB_PID" 2>/dev/null || true; wait "$HUB_PID" 2>/dev/null || true; HUB_PID=""; fi
}
start_hub() {                      # a fresh hub: no accounts, empty data folder
  stop_hub
  rm -rf "$SCR/data"
  LOOKABOUT_IN_CONTAINER=1 PYTHONPATH=hub python3 -m lookabout_hub --data "$SCR/data" --port "$PORT" --web "$WEB" \
    --no-mdns --name "Smoke hub" >"$SCR/hub.log" 2>&1 &
  HUB_PID=$!
  for _ in $(seq 1 60); do
    curl -fsS "http://localhost:$PORT/api/hub" >/dev/null 2>&1 && return 0
    kill -0 "$HUB_PID" 2>/dev/null || { echo "The hub stopped:" >&2; cat "$SCR/hub.log" >&2; exit 1; }
    sleep 0.5
  done
  echo "The hub didn't answer in 30 seconds:" >&2; cat "$SCR/hub.log" >&2; exit 1
}
on_exit() {
  status=$?
  stop_hub
  if [ "$status" -ne 0 ] && [ -f "$SCR/hub.log" ]; then echo "--- hub log ---" >&2; tail -n 40 "$SCR/hub.log" >&2; fi
  exit "$status"
}
trap on_exit EXIT

start_hub
node tests/browser/1-first-admin-household.cjs     # first admin, household, invite (leaves admin-state.json and invite.txt)
node tests/browser/2-passkey-and-invite.cjs        # passkey, join by invite, sign out
node tests/browser/3-google-redirect.cjs           # Google is gated by its wizard; the admin's test link
start_hub                                          # script 4 makes its own first admin
node tests/browser/4-setup-wizards.cjs             # install helper and check, Setup, the wizards
echo "All browser checks passed."
