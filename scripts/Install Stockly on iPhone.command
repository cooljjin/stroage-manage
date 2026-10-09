#!/bin/bash
set -euo pipefail

choice=$(osascript -e 'button returned of (display dialog "설치할 앱을 선택하세요." buttons {"취소", "Stockly 직원용 설치", "Stockly Dev 설치"} default button "Stockly Dev 설치" cancel button "취소")') || exit 0
case "$choice" in
  "Stockly Dev 설치") app=dev ;;
  "Stockly 직원용 설치") app=staff ;;
  *) exit 0 ;;
esac

live_reload=$(osascript -e 'button returned of (display dialog "UI Live Reload를 켤까요?" buttons {"끔", "켬"} default button "끔")') || exit 0

script_dir=$(cd "$(dirname "$0")" && pwd)
args=(--app "$app" --choose-device)
[ "$live_reload" != "켬" ] || args+=(--live-reload)
exec "$script_dir/remote-ios-install.sh" "${args[@]}"
