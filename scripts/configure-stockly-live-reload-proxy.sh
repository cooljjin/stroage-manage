#!/bin/bash
set -euo pipefail

[ "${1:-}" = "--apply" ] || { echo "Usage: $0 --apply" >&2; exit 64; }
tailscale=/Applications/Tailscale.app/Contents/MacOS/tailscale
[ -x "$tailscale" ] || { echo "Tailscale.app is required on this Mac." >&2; exit 1; }

# Reuse the existing Dev mapping (8443 -> 5173); add only Staff (8444 -> 5174).
"$tailscale" serve --https=8444 --bg http://127.0.0.1:5174
"$tailscale" serve status
