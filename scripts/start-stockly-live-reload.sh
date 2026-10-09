#!/bin/bash
set -euo pipefail

app=${1:-}
case "$app" in
  dev) port=5173 ;;
  staff) port=5174 ;;
  *) echo "Usage: $0 <dev|staff>" >&2; exit 64 ;;
esac

tailscale=/Applications/Tailscale.app/Contents/MacOS/tailscale
[ -x "$tailscale" ] || { echo "Tailscale.app is required on this Mac." >&2; exit 1; }
hostname=$("$tailscale" status --json | python3 -c 'import json,sys; print(json.load(sys.stdin)["Self"]["DNSName"].rstrip("."))')

if lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1; then
  echo "$app Live Reload server is already listening on port $port."
  exit 0
fi

echo "$app Live Reload: https://$hostname:$((port + 3270))"
exec env STOCKLY_LIVE_RELOAD_HOST="$hostname" npm run dev -- --mode staging --host 127.0.0.1 --port "$port" --strictPort
