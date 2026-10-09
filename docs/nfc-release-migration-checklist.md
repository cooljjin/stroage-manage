# Stockly NFC 배포판 전환 체크리스트

작성일: 2026-10-04 (KST)
상태: 배포 준비 문서 — 전환 작업 및 배포판 검증 미실행

## 목적과 범위

개발용 Stockly Dev에서 확인한 NFC → 앱 실행 → 해당 품목의 재고 작업 흐름을 TestFlight와 정식 배포에서도 개발자 설정 없이 제공한다.

이 문서 작성은 코드 수정, 태그 재기록, DB 변경, 웹 배포, TestFlight 업로드를 승인하거나 실행한 것이 아니다. 앱 식별자·태그 주소·서명·공개 앱 연결·실기기 동작을 각각 확인한다.

## 1. 확인된 상태와 남은 검증

| 항목 | 확인 상태 |
| --- | --- |
| 실기기 Universal Links 진단 | 제공된 화면에서 `RQMBNM7XVV.com.jinkim.stockly.dev` 연결 성공 확인 |
| 개발용 재고 작업 | 사용자가 정상 작동을 확인함. 앱 종료/실행 중 등 모든 개별 시나리오의 증거가 확보된 것은 아님 |
| 배포용 소스 설정 | 일반 Associated Domains와 배포용 NFC 경로가 로컬 소스에 존재 |
| 공개 AASA 및 Apple CDN | 이번 문서 작성 시 재확인하지 않음 |
| 배포판 최종 서명 및 설치 | 미검증 |
| TestFlight·정식 배포에서 실제 NFC 동작 | 미검증 |

개발용 성공은 배포판의 앱 연결이나 기존 태그 호환성을 자동으로 보장하지 않는다.

## 2. 배포 대상 확정

| 대상 | Bundle ID | 역할 |
| --- | --- | --- |
| Stockly Dev | `com.jinkim.stockly.dev` | 현재 실기기 진단으로 확인한 개발용 앱 |
| Stockly | `com.jinkim.stockly` | 기본 TestFlight/정식 배포 전환 후보 |
| 직원용 앱 | `com.jinkim.storeinventory.poc` | 별도 직원 배포 채널, 명시적으로 선택할 때만 대상 |

- [ ] 배포 대상 앱, Xcode scheme/configuration, App Store Connect 앱 기록을 확정한다.
- [ ] 백엔드 환경(staging/production)은 Bundle ID와 별도로 확정한다.
- [ ] 실제 Release 빌드 설정과 최종 IPA의 Bundle ID가 선택한 대상과 같은지 확인한다.
- [ ] 직원용 앱과 개발용 앱의 기존 배포 설정을 보존한다.

`com.jinkim.stockly`로 전환하면 `.dev` 앱과 별도 앱이다. 로그인·로컬 설정·로컬 저장 데이터가 자동으로 이어진다고 가정하지 않는다. 같은 백엔드의 서버 데이터 사용 여부는 선택한 환경과 계정·매장 권한에 따라 확인한다.

## 3. NFC 태그 주소 전환 — 우선 결정할 항목

현재 소스의 품목 주소:

```text
개발용: https://stroage-manage.vercel.app/nfc/dev/product/<품목 ID>
배포용: https://stroage-manage.vercel.app/nfc/product/<품목 ID>
```

현재 로컬 AASA는 개발용 경로를 `.dev` 앱에 연결한다. 기본 배포용·직원용 앱에는 일반 경로가 등록되어 있다. 품목 URL 파서도 production 채널에서 개발용 경로를 허용하지 않는다.

따라서 개발용 경로가 기록된 태그는 배포판에서 그대로 작동한다고 보장할 수 없다. AASA만 바꾸거나 앱 파서만 바꾸는 것으로 호환 작업을 완료했다고 판단하지 않는다.

### 권장: 테스트 태그를 배포용 주소로 재기록

- [ ] 실제 태그의 원본 NDEF URI를 확인한다. 브라우저의 최종 주소만으로 판정하지 않는다.
- [ ] 테스트 태그를 배포판의 일반 경로로 다시 기록한다.
- [ ] 재기록 후 태그를 읽어 실제 URI가 맞는지 확인한다.
- [ ] 초기 검증은 배포 대상 앱만 설치한 기기에서 수행한다.

### 기존 태그를 유지해야 할 때만 호환 지원

- [ ] 현장에 배포된 태그 수와 재기록 가능 여부를 확인한다.
- [ ] 배포판이 개발용 경로를 처리하도록 AASA와 앱의 URL 파서를 함께 검토한다.
- [ ] 같은 링크를 여러 앱이 처리할 때의 연결 대상과 병행 설치 정책을 정한다.
- [ ] 기존 태그, 새 태그, 앱 병행 설치 상태를 각각 검증한다.

현재 일반 경로는 기본 배포용·직원용·개발용 앱이 함께 등록되어 있다. AASA의 주석이나 등록 순서만으로 원하는 앱이 반드시 열리는지 단정하지 않는다. 개발용 경로를 배포판에도 추가하면 개발용 앱과의 경로 중복도 생기므로 실제 설치 조합별 확인이 필요하다.

## 4. 일반 Universal Links 연결 준비

- [ ] 배포판은 `applinks:stroage-manage.vercel.app`을 사용하며 `?mode=developer`에 의존하지 않는다.
- [ ] Apple App ID와 배포 프로비저닝 프로파일에 필요한 Associated Domains 권한이 포함되어 있다.
- [ ] 공개 `/.well-known/apple-app-site-association`이 리디렉션 없이 JSON으로 제공된다.
- [ ] AASA의 앱 식별자(Team ID + Bundle ID)와 실제 사용하는 URI 경로가 맞다.
- [ ] 웹 원본과 Apple CDN의 AASA를 별도로 확인한다. 원본 응답 성공만으로 CDN·기기 반영을 완료 처리하지 않는다.
- [ ] 기기의 ‘연결된 도메인 개발’ 우회에 의존하지 않는 상태에서 연결을 검증한다.

한국어 진단 위치: 설정 → 개발자 → **유니버설 링크** 구역 → **진단**.
개발용 우회 스위치: **연결된 도메인 개발**.
이 명칭은 Apple iOS 26.5 설정 리소스로 확인했으며, 배포판 일반 사용자가 개발자 설정을 켜야 하는 흐름으로 설계하지 않는다.

로컬 설정의 존재, 공개 원본 반영, Apple CDN 반영, 설치된 앱의 연결 승인은 서로 다른 검증 항목이다.

## 5. 배포 빌드·환경·인증·서명 확인

현재 `src/App.tsx`와 `src/pages/InventoryOperationPage.tsx`는 `import.meta.env.MODE === "staging"` 여부로 NFC development/production 채널을 선택한다. Bundle ID만 배포용으로 변경하면 태그 주소 정책까지 바뀌는 것은 아니다.

- [ ] 선택한 백엔드와 NFC 경로 정책이 빌드 모드의 실제 동작과 일치한다.
- [ ] staging 백엔드를 사용하는 TestFlight 빌드가 필요하면 NFC 경로 선택까지 검토한다. staging 빌드가 자동으로 배포용 경로를 만든다고 가정하지 않는다.
- [ ] 배포 앱은 로컬 웹 자산을 포함하고, 개발용 Tailnet/Vite 서버 없이 실행된다.
- [ ] 선택한 환경으로 웹 빌드 → Capacitor sync → archive 순서로 실행한다.
- [ ] 관련 NFC URL·네이티브 라우팅 계약 테스트, build, lint를 실행한다.
- [ ] archive와 최종 IPA가 동일한 의도된 웹 자산을 포함한다.
- [ ] 최종 IPA의 Bundle ID, 버전·빌드 번호, 서명, 프로비저닝 프로파일을 확인한다.
- [ ] 최종 서명에 Associated Domains와 NFC `TAG` 권한이 포함되어 있다.
- [ ] 배포 대상 App Store Connect 앱의 기존 빌드 번호를 조회하고 새 번호를 사용한다.
- [ ] OAuth callback·URL scheme·Supabase Redirect URLs·Apple 로그인 Client ID가 선택한 앱과 백엔드에 맞다.

서명 없는 컴파일 성공은 배포 서명이나 물리 NFC 동작을 증명하지 않는다. 개발용 CDN 우회 테스트 artifact와 배포용 artifact를 혼용하지 않는다.

## 6. TestFlight 실기기 통과 기준

테스트 계정과 테스트 매장·테스트 품목만 사용한다. 운영 매장 데이터는 별도 승인 없이 조회·수정하지 않는다. 테스트마다 앱 식별자, 설치 빌드, iOS 버전, 백엔드 환경, 태그 URI, 설치된 다른 앱, 실제 결과를 기록한다.

- [ ] 개발용 도메인 우회에 의존하지 않는 상태에서 앱 연결이 정상이다.
- [ ] 앱이 실행되지 않은 상태에서 태그 알림을 눌러 해당 품목의 재고 작업으로 이동한다.
- [ ] 앱 실행 중 인앱 NFC 스캔으로 같은 품목의 재고 작업으로 이동한다.
- [ ] 로그아웃 상태에서 NFC로 진입한 뒤 로그인해도 대상 품목이 유지된다.
- [ ] 다른 매장 또는 접근 불가능한 품목은 안전하게 차단된다.
- [ ] 삭제·비활성 품목이나 잘못된 링크에 대해 안전한 안내를 제공한다.
- [ ] 새로 기록한 태그와 유지하기로 한 기존 태그가 각각 정상이다.
- [ ] 다른 앱이 없는 상태와 개발용·직원용 앱을 병행 설치한 상태의 연결 대상이 정책과 같다.
- [ ] 앱 미설치 시 공개 웹 fallback이 안전하게 동작한다.
- [ ] 개발용 서버·Tailscale 연결 없이 배포 앱의 재고 작업이 동작한다. 백엔드 사용을 위한 일반 인터넷 연결은 별개다.

Universal Links 진단 성공, 프로그램으로 앱 실행 성공, URL 파서 테스트 성공은 실제 태그 스캔의 대체 증거가 아니다.

## 7. 진행 순서와 중단 기준

1. 배포 대상과 백엔드 확정
2. 태그 재기록 또는 기존 경로 호환 방침 결정
3. 필요한 최소 코드·AASA 변경과 로컬 검증
4. 승인된 웹 배포 후 원본·Apple CDN 확인
5. 선택한 앱의 배포 빌드·서명 검증
6. 승인된 TestFlight 업로드와 처리 상태·테스터 그룹 확인
7. 실기기 체크리스트 통과
8. 정식 배포 및 배포 후 NFC 점검

중단 기준:

- 앱 식별자·태그 경로·백엔드 환경이 미확정이면 빌드·업로드 전에 중단한다.
- 공개 연결이나 최종 서명 검증 실패를 앱 재배포만으로 해결됐다고 처리하지 않는다.
- 실제 NFC가 웹으로 열리거나 잘못된 앱·품목으로 이동하면 정식 출시를 보류한다.
- 태그 경로 전환 전에 이전 앱으로 복귀할 때의 호환성도 정한다. 새 태그가 구버전에서 작동한다고 가정하지 않는다.

NFC 연결 전환만을 위해 DB migration을 추가하지 않는다. 선택한 앱 기능이 새로운 DB/RPC를 실제로 요구하는 경우에만 별도 승인·검증 범위로 처리한다.

## 8. 출처와 유지보수 기준

### 로컬 소스 근거

- `ios/App/App.xcodeproj/project.pbxproj`: 앱 식별자와 서명 설정
- `ios/App/App/AppNfcRelease.entitlements`: 일반 Associated Domains·NFC 권한
- `public/apple-app-site-association`: 앱별 연결 경로
- `src/lib/productNfc.ts`: 품목 URL 생성·파싱
- `src/App.tsx`: 빌드 모드별 URL 처리 채널
- `src/pages/InventoryOperationPage.tsx`: 태그 기록 채널
- `README.md`, `AGENTS.md`: 배포 채널·개발 서버·테스트 격리 규칙

작성 시점의 로컬 작업 트리 기준이며 미커밋 변경이 포함되어 있다. 문서는 원격 배포 상태나 최종 서명 결과를 보증하지 않는다. 실제 배포 때 대상 revision과 파일 설정을 다시 확인한다.

### Apple 공식 참고 문서

- [Supporting associated domains](https://developer.apple.com/documentation/xcode/supporting-associated-domains)
- [Debugging universal links (TN3155)](https://developer.apple.com/documentation/technotes/tn3155-debugging-universal-links)
- [Associated Domains Entitlement](https://developer.apple.com/documentation/bundleresources/entitlements/com.apple.developer.associated-domains)
- [Adding support for background tag reading](https://developer.apple.com/documentation/corenfc/adding-support-for-background-tag-reading)
