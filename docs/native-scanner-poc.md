# Stockly 바코드 스캐너 구현과 검증

마지막 코드 점검: 2026-08-13

파일명에는 `poc`가 남아 있지만 현재 저장소에는 iOS·Android·웹 스캐너가 실제 앱 흐름에 연결되어 있다.

## 현재 우선순위

1. iOS Capacitor: 로컬 `FastBarcodeScanner` 우선
2. Android Capacitor: `@capacitor-mlkit/barcode-scanning` 우선
3. 네이티브 미지원·실행 실패·Android 모듈 설치 중: 웹 스캐너로 fallback
4. 일반 웹/PWA: `html5-qrcode`

카메라 권한 거부는 웹 fallback 없이 오류로 안내한다.

## 현재 구성

- 공통 흐름: `src/pages/ScanPage.tsx`
- native wrapper: `src/lib/nativeBarcodeScanner.ts`
- iOS plugin: `ios/App/App/FastBarcodeScannerPlugin.swift`
- iOS 등록: `ios/App/App/AppViewController.swift`
- Android manifest: `android/app/src/main/AndroidManifest.xml`
- 웹 fallback: `html5-qrcode`

지원 형식:

- EAN-13, EAN-8
- UPC-A, UPC-E
- Code 128, Code 39, Code 93
- ITF
- Codabar

## 스캔 뒤 이동

- 활성 상품의 기본 바코드: 재고 작업 화면
- `product_barcodes`의 보조 바코드: 연결된 상품의 재고 작업 화면
- 미등록 바코드: 상품 등록 화면
- `receipt_check_only` 상품: 일반 상품과 동일하게 재고 작업 화면

12자리와 앞자리 `0`이 붙은 13자리 바코드는 서로 후보로 조회한다.

`PENDING_SCAN_STORAGE_KEY`, `completedNavigationRef`, `barcodeHandlingRef`, `scanAttemptRef`는 네이티브/웹 전환 중 값 유실과 중복 이동을 막는다. 이 부분은 단순화하거나 제거하지 않는다.

## iOS 고속 스캐너

`FastBarcodeScanner`는 `AVCaptureMetadataOutput`으로 첫 유효 바코드를 반환한다.

- 기본 zoom factor: 1.25
- 전체 화면 native camera
- 하단 `상품등록` 버튼으로 빈 바코드의 등록 화면 이동 가능
- 닫기 버튼은 스캔을 취소하고 홈으로 이동
- 권한 문구: `ios/App/App/Info.plist`
- iOS 최소 버전: 15.5

`@capacitor-mlkit/barcode-scanning`이 fallback 경로에 있으므로 iOS project는 CocoaPods를 사용한다.

## Android

Manifest에 다음이 설정되어 있다.

```xml
<uses-permission android:name="android.permission.CAMERA" />

<meta-data
    android:name="com.google.mlkit.vision.DEPENDENCIES"
    android:value="barcode_ui" />
```

Google barcode module이 아직 없으면 설치를 시작하고 해당 시도에서는 웹 스캐너로 전환한다.

## 웹 fallback

- 후면 카메라 우선
- 12fps
- 4:3 video
- 지원 기기에서 continuous focus와 zoom 사용
- 사진 파일 또는 카메라 촬영 이미지에서 바코드 인식 가능
- 상품명·기본 바코드·보조 바코드 검색 지원

## 기존 프로젝트에서 준비

플랫폼과 패키지는 이미 저장소에 추가되어 있으므로 `npx cap add`나 `ios/` 삭제를 반복하지 않는다.

의존성 설치 후 동기화:

```bash
npm ci
npm run build
npm run cap:sync
```

iOS:

```bash
npm run ios:prepare
npm run cap:ios
```

Android:

```bash
npm run cap:android
```

## 수동 검증

- 등록 일반 상품 기본 바코드 → 재고 작업
- 등록 `receipt_check_only` 상품 → 재고 작업
- 보조 바코드 → 연결 상품 재고 작업
- 미등록 바코드 → 상품 등록, 스캔 값 유지
- 12자리/13자리 앞자리 0 후보
- native 스캔 취소 → 중복 화면 이동 없음
- native 실패 → 웹 fallback 1회만 시작
- 카메라 권한 거부 메시지
- 사진으로 바코드 인식
- 같은 바코드 연속 인식 시 저장·이동 1회

속도 비교가 필요하면 같은 바코드를 각 경로에서 20회씩 스캔해 평균 인식 시간과 실패 횟수를 기록한다.
