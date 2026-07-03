# 네이티브 바코드 스캐너 PoC

이 PoC는 기존 Vercel 웹앱을 Capacitor WebView로 열고, 앱 안에서만 네이티브 바코드 스캐너를 우선 사용한다.

## 설치 명령

네트워크가 가능한 환경에서 아래 명령으로 Capacitor와 바코드 플러그인을 설치한다.

```bash
npm install @capacitor/core @capacitor/cli @capacitor/android @capacitor/ios @capacitor-mlkit/barcode-scanning
npm run build
npx cap add android
npx cap add ios --packagemanager CocoaPods
npx cap sync
```

## Android 설정

`android/app/src/main/AndroidManifest.xml`의 `application` 태그 밖에 카메라 권한을 추가한다.

```xml
<uses-permission android:name="android.permission.CAMERA" />
```

`application` 태그 안에 ML Kit barcode UI metadata를 추가한다.

```xml
<meta-data android:name="com.google.mlkit.vision.DEPENDENCIES" android:value="barcode_ui" />
```

## iOS 설정

Capacitor 8은 기본값으로 iOS 프로젝트를 SPM 방식으로 생성한다. `@capacitor-mlkit/barcode-scanning`은 현재 CocoaPods용 podspec을 제공하므로 iOS PoC는 CocoaPods 방식으로 생성한다.

이미 `npx cap add ios`로 SPM 프로젝트를 만들었다면 `ios/`를 삭제하고 아래 명령으로 다시 생성한다.

```bash
npx cap add ios --packagemanager CocoaPods
```

`ios/App/Podfile`이 생성되면 최소 타깃을 15.5 이상으로 둔다.

```ruby
platform :ios, '15.5'
```

`ios/App/App/Info.plist`에 카메라 권한 문구를 추가한다.

```xml
<key>NSCameraUsageDescription</key>
<string>상품 바코드를 스캔하기 위해 카메라를 사용합니다.</string>
```

## 검증

- 일반 브라우저: 기존 `html5-qrcode` 웹 스캐너 사용
- Capacitor 앱: 네이티브 스캐너 우선 사용
- 네이티브 스캐너 미지원, 실행 실패, Android 모듈 설치 중: 웹 스캐너로 fallback
- 권한 거부: 오류 메시지 표시

반복 측정은 같은 바코드를 20회씩 스캔해서 평균 인식 시간과 실패 횟수를 기록한다.

## iOS 고속 스캐너

iOS는 `@capacitor-mlkit/barcode-scanning`의 `scan()` 대신 앱 내부 로컬 플러그인 `FastBarcodeScanner`를 우선 사용한다.

- 구현: `ios/App/App/FastBarcodeScannerPlugin.swift`
- 등록: `ios/App/App/AppViewController.swift`
- 방식: `AVCaptureMetadataOutput`으로 바코드가 감지되는 첫 프레임에서 즉시 반환
- 포맷: EAN-13, EAN-8, UPC, Code128, Code39, Code93, ITF, Codabar

현재 iOS 직원용 내부 테스트는 `server.url`을 제거한 로컬 번들 방식이다. 앱 화면이나 스캔 로직을 바꾸면 `npm run ios:prepare` 후 Xcode에서 다시 설치해야 한다.
