# TestFlight 직원 배포 절차

## 현재 배포 방식

현재 iOS 앱은 Capacitor 앱 안에 빌드된 웹앱을 포함하는 방식이다.

- 직원은 TestFlight 앱으로 설치한다.
- 직원 iPhone에서 개발자 모드를 켤 필요가 없다.
- 웹 코드가 앱 안에 포함되므로, 앱 수정 후 직원에게 반영하려면 새 TestFlight 빌드를 올려야 한다.
- App Store 공개 배포 전까지는 TestFlight로 직원 사용성을 검증한다.

## 1. 업로드 전 앱 준비

터미널에서 프로젝트 폴더로 이동한 뒤 실행한다.

```bash
cd "/Users/jinkim/Documents/storage manage"
npm run ios:prepare
```

이 명령은 React 앱을 새로 빌드하고 iOS 앱 안에 복사한다.

## 2. Xcode에서 Archive 만들기

```bash
npx cap open ios
```

Xcode가 열리면 아래를 확인한다.

1. 왼쪽 프로젝트에서 `App` 타깃을 선택한다.
2. `Signing & Capabilities`에서 Apple Developer Program에 가입한 팀을 선택한다.
3. Bundle Identifier는 현재 `com.jinkim.storeinventory.poc`를 사용한다.
4. `General`에서 Version과 Build를 확인한다.
5. 상단 실행 대상은 실제 iPhone이 아니라 `Any iOS Device (arm64)` 또는 `Any iOS Device`로 선택한다.
6. 메뉴에서 `Product > Archive`를 실행한다.

주의: TestFlight에 같은 Build 번호를 두 번 올릴 수 없다. 다음 업로드부터는 Build 값을 `2`, `3`, `4`처럼 올려야 한다.

## 3. App Store Connect로 업로드

Archive가 끝나면 Organizer 창이 열린다.

1. 방금 만든 Archive를 선택한다.
2. `Distribute App`을 누른다.
3. `App Store Connect`를 선택한다.
4. `Upload`를 선택한다.
5. 서명 옵션은 기본 자동 서명을 사용한다.
6. 업로드를 완료한다.

업로드 후 Apple 처리 시간이 필요하다. 처리가 끝나면 App Store Connect의 TestFlight 탭에서 빌드가 보인다.

## 4. App Store Connect 앱 생성

처음 업로드라면 App Store Connect에서 앱을 먼저 만들거나, 업로드 후 앱 레코드를 연결해야 한다.

- 앱 이름: `매장 재고관리`
- 플랫폼: iOS
- Bundle ID: `com.jinkim.storeinventory.poc`
- SKU: 내부 식별용 아무 값. 예: `store-inventory-ios`

Bundle ID는 직원에게 보이지 않는다. 나중에 App Store 정식 공개를 별도 앱 ID로 진행하고 싶으면 그 시점에 새 앱으로 분리할 수 있다.

## 5. TestFlight 테스트 정보 입력

App Store Connect에서 앱을 열고 `TestFlight` 탭으로 이동한다.

필수 입력 예시:

- Beta App Description: `매장 재고 조사 및 입출고 처리를 위한 내부 테스트 앱입니다.`
- Feedback Email: 개발자 또는 매장 관리자 이메일
- What to Test: `iPhone 카메라 바코드 스캔 속도, 상품 조회, 입고/출고 처리 흐름을 확인합니다.`

## 6. 직원 초대 방식

직원은 보통 외부 테스터로 초대하는 것이 편하다.

1. `TestFlight > External Testing`에서 그룹을 만든다.
2. 그룹 이름은 `매장 직원`처럼 지정한다.
3. 업로드한 빌드를 그룹에 추가한다.
4. 직원 이메일을 추가하거나 공개 링크를 만든다.
5. 첫 외부 테스트 빌드는 Apple의 Beta App Review 승인이 필요하다.

승인이 끝나면 직원은 iPhone에서 TestFlight 앱을 설치하고 초대 링크를 열어 앱을 설치한다.

## 7. 업데이트 배포 흐름

앱을 수정한 뒤 직원에게 새 버전을 보내는 흐름은 항상 같다.

1. 코드 수정
2. Build 번호 증가
3. `npm run ios:prepare`
4. Xcode에서 Archive
5. App Store Connect Upload
6. TestFlight 빌드 배포

작은 수정도 현재 구조에서는 새 TestFlight 빌드가 필요하다. 운영 단계에서 웹 즉시 반영 방식이 필요하면 별도 배포 구조로 다시 결정한다.
