# 원격 iPhone 개발 설치

MacBook에서는 한 번만 `npm ci`와 `gem install --user-install cocoapods`를 실행한다. 이후 `scripts/Install Stockly on iPhone.command`를 더블클릭해 **Stockly Dev** 또는 **Stockly 직원용**을 고른다. 연결된 iPhone이 하나일 때만 설치하며, 로컬 변경이 있으면 덮어쓰지 않고 중단한다.

UI 즉시 반영은 Mac mini에서 각각 실행한다.

```bash
scripts/start-stockly-live-reload.sh dev
scripts/start-stockly-live-reload.sh staff
```

MacBook에서 Live Reload 앱을 설치하려면 선택한 앱에 `--live-reload`를 붙인다. iPhone도 같은 Tailscale 네트워크와 Tailscale DNS를 사용해야 한다. Swift·NFC·서명·플러그인 변경은 Live Reload가 아니라 해당 앱을 다시 설치해야 한다.

Release/TestFlight 빌드는 Live Reload URL을 읽지 않는다.
