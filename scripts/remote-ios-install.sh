#!/bin/bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage: scripts/remote-ios-install.sh --app <dev|staff> [--live-reload] (--device <UDID>|--choose-device)
EOF
}

app=
live_reload=false
device=
choose_device=false
while [ "$#" -gt 0 ]; do
  case "$1" in
    --app) app=${2:-}; shift 2 ;;
    --live-reload) live_reload=true; shift ;;
    --device) device=${2:-}; shift 2 ;;
    --choose-device) choose_device=true; shift ;;
    -h|--help) usage; exit 0 ;;
    *) usage >&2; exit 64 ;;
  esac
done

case "$app" in
  dev) scheme=App; bundle_id=com.jinkim.stockly; live_port=8443 ;;
  staff) scheme="Stockly Staff"; bundle_id=com.jinkim.storeinventory.poc; live_port=8444 ;;
  *) usage >&2; exit 64 ;;
esac

if [ -n "$device" ] && [ "$choose_device" = true ]; then
  echo "Use either --device or --choose-device, not both." >&2
  exit 64
fi

if [ "$choose_device" = true ]; then
  devices_json=$(mktemp)
  trap 'rm -f "$devices_json"' EXIT
  xcrun devicectl list devices --json-output "$devices_json" >/dev/null
  device=$(python3 - "$devices_json" <<'PY'
import json, sys
with open(sys.argv[1]) as f:
    items = json.load(f)["result"]["devices"]
phones = [d for d in items if d.get("properties", {}).get("hardware", {}).get("reality") == "physical" and d.get("properties", {}).get("connection", {}).get("state") in {"available", "connected"}]
if len(phones) != 1:
    for d in phones:
        print(f'{d["properties"]["state"].get("name", "iPhone")}\t{d["properties"]["hardware"]["udid"]}', file=sys.stderr)
    raise SystemExit("Connect exactly one available physical iPhone, or run with --device <UDID>.")
print(phones[0]["properties"]["hardware"]["udid"])
PY
  )
fi
[ -n "$device" ] || { usage >&2; exit 64; }

if [ -n "$(git status --porcelain)" ]; then
  echo "Refusing to update: this MacBook checkout has local changes. Commit, stash, or use a clean clone first." >&2
  exit 1
fi

git fetch --prune origin
git merge --ff-only origin/main

if [ ! -d node_modules ] || [ package-lock.json -nt node_modules/.package-lock.json ]; then
  npm ci --prefer-offline
fi

if ! command -v pod >/dev/null 2>&1; then
  gem_bin="$(ruby -e 'require "rubygems"; print Gem.user_dir')/bin"
  export PATH="$gem_bin:$PATH"
fi
command -v pod >/dev/null 2>&1 || { echo "CocoaPods is required. Run: gem install --user-install cocoapods" >&2; exit 1; }

npm run ios:prepare
npx cap sync ios

live_url=
if [ "$live_reload" = true ]; then
  live_host=${STOCKLY_DEV_SERVER_HOST:-macmini-1.tailc45cff.ts.net}
  live_url="https://$live_host:$live_port"
  case "$live_host" in *.ts.net) ;; *) echo "STOCKLY_DEV_SERVER_HOST must be a Tailscale DNS host." >&2; exit 64 ;; esac
  curl --fail --silent --show-error --max-time 10 "$live_url/" >/dev/null
fi

derived_data="$PWD/tmp/remote-ios-$app"
mkdir -p "$derived_data"
build_args=( -workspace ios/App/App.xcworkspace -scheme "$scheme" -configuration Debug -sdk iphoneos -destination "id=$device" -derivedDataPath "$derived_data" )
if [ -n "$live_url" ]; then
  build_args+=( "STOCKLY_LIVE_RELOAD_URL=$live_url" )
fi

app_path=$(xcodebuild "${build_args[@]}" -showBuildSettings -json | python3 -c 'import json,sys; x=json.load(sys.stdin)[0]["buildSettings"]; print(x["TARGET_BUILD_DIR"] + "/" + x["FULL_PRODUCT_NAME"])')
xcodebuild "${build_args[@]}" build
[ -d "$app_path" ] || { echo "Build succeeded but the expected app bundle was not found: $app_path" >&2; exit 1; }
codesign --verify --deep --strict "$app_path"

xcrun devicectl device install app --device "$device" "$app_path"
installed=$(xcrun devicectl device info apps --device "$device" --bundle-id "$bundle_id" --json-output -)
printf '%s' "$installed" | python3 -c 'import json,sys; payload=json.load(sys.stdin); text=json.dumps(payload); bundle=sys.argv[1]; assert bundle in text, f"Installed app readback did not contain {bundle}"' "$bundle_id"
xcrun devicectl device process launch --terminate-existing --activate --device "$device" "$bundle_id"

echo "Installed and launched: $scheme ($bundle_id)"
[ -z "$live_url" ] || echo "Live Reload enabled: $live_url"
