# iOS 직원용 설치 절차

이 문서는 App Store 배포 전, 매장 직원 iPhone에 내부 테스트용 앱을 설치하는 절차다.

## 현재 방식

- 앱은 로컬 번들 방식으로 실행된다.
- `capacitor.config.json`에 `server.url`이 없으므로 앱 안에 복사된 최신 `dist` 화면을 사용한다.
- iOS에서는 `FastBarcodeScanner`가 먼저 실행되고, Android는 기존 ML Kit 스캐너를 유지한다.
- 앱 화면을 바꾸면 iPhone에 다시 설치해야 반영된다.

## 설치 전 준비

```bash
cd "/Users/jinkim/Documents/storage manage"
npm run ios:prepare
npx cap open ios
```

Xcode가 열리면:

- `App.xcworkspace` 기준으로 열린 상태인지 확인
- 실행 대상에서 직원 iPhone 선택
- `Signing & Capabilities`에서 Team 선택
- Run 실행

## 직원 폰 추가 설치

직원 iPhone마다 한 번씩 아래를 확인한다.

- iPhone 잠금 해제
- Mac을 신뢰
- 개발자 모드가 필요하면 iPhone 설정에서 허용
- Xcode 실행 대상에서 해당 iPhone 선택 후 Run

## 업데이트 절차

화면 코드나 스캔 로직을 수정한 뒤:

```bash
cd "/Users/jinkim/Documents/storage manage"
npm run ios:prepare
npx cap open ios
```

Xcode에서 각 직원 iPhone에 다시 Run 한다.

## 주의

- 무료 Apple 계정으로 설치하면 일정 기간 뒤 앱이 만료될 수 있다.
- 여러 직원이 계속 써야 하면 Apple Developer Program 가입 후 TestFlight 또는 Ad Hoc 배포가 더 안정적이다.
- Vercel URL 로드 방식으로 돌아가면 웹 배포만으로 화면 업데이트가 가능하지만, 네이티브 스캐너 플러그인 변경은 앱 재설치가 필요하다.
