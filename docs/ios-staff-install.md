# iOS 직원용 Xcode 직접 설치

마지막 설정 점검: 2026-08-13

이 문서는 TestFlight가 아니라 Mac과 Xcode로 특정 직원 iPhone에 개발용 빌드를 직접 설치하는 절차다. 여러 직원에게 지속 배포하려면 `testflight-staff-deployment.md`를 사용한다.

## 현재 앱 설정

- 앱 이름: `Stockly`
- Bundle ID: `com.jinkim.stockly`
- iOS deployment target: 15.5
- 현재 Xcode 설정: Version 1.0, Build 6
- workspace: `ios/App/App.xcworkspace`
- 웹 번들: `dist`
- `server.url` 없음

설치된 앱은 Vercel이 아니라 앱 안에 복사된 `dist`를 사용한다. 웹 코드가 바뀌어도 새 빌드를 기기에 설치하기 전에는 반영되지 않는다.

## 준비

```bash
cd "/Users/jinkim/Documents/storage manage"
npm ci
npm run ios:prepare
npm run cap:ios
```

`npm run ios:prepare`는 고객용 React 앱을 빌드하고 iOS project에 복사한다. 운영자 콘솔은 iOS 고객용 앱에 포함되지 않는다.

## Xcode에서 설치

1. `App.xcworkspace`가 열린 상태인지 확인한다.
2. `App` target의 `Signing & Capabilities`에서 올바른 Team을 선택한다.
3. 실행 대상을 연결한 직원 iPhone으로 선택한다.
4. iPhone을 잠금 해제하고 Mac을 신뢰한다.
5. 필요한 경우 iPhone에서 개발자 모드를 활성화한다.
6. Xcode에서 Run을 실행한다.
7. 앱 실행 후 로그인, OAuth callback, 카메라 권한, 바코드 스캔을 확인한다.

## 업데이트

코드를 수정한 뒤에는 다시 실행한다.

```bash
npm run ios:prepare
npm run cap:ios
```

그다음 각 iPhone을 대상으로 Xcode Run을 다시 수행한다. Vercel 배포만으로 직접 설치 앱은 갱신되지 않는다.

## 주의

- 무료 Apple 계정 서명은 설치 유효기간과 기기 수에 제한이 있을 수 있다.
- 개발용 직접 설치에는 직원 iPhone의 개발자 모드가 필요할 수 있다.
- `npx cap sync ios`는 native plugin과 Pod 구성을 바꿀 때 사용한다. 단순 웹 코드 반영에는 `npm run ios:prepare`가 기본이다.
- native plugin이나 Pod 변경 후 문제가 생기면 Xcode `Product > Clean Build Folder`, `pod install`, `cap sync` 순서로 원인을 분리한다.
- App Store/TestFlight build 번호는 재사용할 수 없지만 Xcode 직접 설치만을 위해 매번 번호를 올릴 필요는 없다.
