# Stockly

Stockly는 매장의 재고, 발주, 입고 확인, To do, 인수인계, 프랩, 단체주문을 관리하는 React/Vite 앱이다. Supabase를 백엔드로 사용하며 웹/PWA와 Capacitor iOS·Android 앱을 함께 지원한다.

이 문서는 2026-08-13 로컬 소스 기준이다. 원격 Supabase 마이그레이션, Edge Function, Vercel, TestFlight 상태는 별도로 확인해야 한다.

## 주요 구성

- 고객용 앱: `src/`
- 운영자용 별도 콘솔: `admin-console/`
- Supabase 마이그레이션: `supabase/migrations/`
- Supabase Edge Functions: `supabase/functions/`
- iOS 프로젝트: `ios/App/App.xcworkspace`
- Android 프로젝트: `android/`
- 운영·기능 문서: `docs/`

고객용 앱에서 `master` 계정은 매장 화면에 들어가지 못한다. 전체 매장·전체 사용자 관리는 별도 운영 콘솔에서만 수행한다.

## 기술 스택

- React 18, TypeScript, Vite 6
- Tailwind CSS
- Supabase JS v2
- Capacitor 8
- PWA (`vite-plugin-pwa`)
- 네이티브 스캔: `@capacitor-mlkit/barcode-scanning`
- 웹 스캔: `html5-qrcode`
- 아이콘: `lucide-react`
- 애니메이션: `motion`

## 로컬 실행

Node.js와 npm이 필요하다.

```bash
npm ci
```

프로젝트 루트에 `.env`를 만들고 다음 값을 설정한다.

```text
VITE_SUPABASE_URL=https://<project-ref>.supabase.co
VITE_SUPABASE_ANON_KEY=<anon-key>
```

고객용 앱:

```bash
npm run dev
```

운영자 콘솔:

```bash
npm run dev:admin
```

## 검증 명령

기본 검증:

```bash
npm run build
npm run lint
```

운영자 콘솔도 수정했다면:

```bash
npm run build:admin
```

`npm run lint`는 저장소 전체를 검사하므로 `dist-admin/`이나 `tmp/` 같은 생성물이 있으면 별도 오류가 섞일 수 있다. 이 경우 원인을 분리해 보고하고 소스 범위는 다음 명령으로 확인한다.

```bash
npx eslint src admin-console
```

## 인증과 매장 연결

지원 로그인: 이메일/비밀번호, Google·Kakao·Apple OAuth.

로그인한 계정에 프로필이 없으면 다음 중 하나로 매장을 연결한다.

- `새 매장 만들기`: 본인이 `store_admin`인 개인 매장 생성
- `초대코드로 참여`: 관리자가 만든 8자리 코드를 입력해 기존 매장에 참여

초대 공유 링크 형식은 다음과 같다.

```text
https://<app-origin>/?inviteCode=ABCD2345
```

앱은 `inviteCode`, `invite_code`, `code` 쿼리 값을 읽어 로그인 뒤 매장 연결 화면에 보존한다. 이미 매장에 연결된 계정은 다른 초대코드를 사용할 수 없다.

네이티브 OAuth callback:

```text
com.jinkim.stockly://auth/callback
```

Supabase Auth Redirect URLs와 iOS/Android URL scheme 설정이 모두 필요하다.

> **확인 필요:** 단일 callback의 채널 범위는 [이중 채널 규칙](AGENTS.md#ios-testflight-배포-채널)과 대조한다.

## 역할과 권한

- `master`: 별도 운영자 콘솔에서 전체 매장과 사용자를 관리
- `store_admin`: 본인 매장의 설정, 직원, 권한, 품목 기준정보를 관리
- `staff`: 재고 업무를 수행하며 필요한 관리 권한을 선택적으로 부여받을 수 있음

직원 선택 권한: 카테고리 관리, 발주처 관리, 메뉴 레시피 등록, 발주 품목 확정.

프런트엔드의 메뉴 숨김은 편의를 위한 것이고 실제 데이터 보호는 Supabase RLS와 RPC 검증이 담당해야 한다.

## Supabase 의존성 규칙

직접 접근 허용 위치·용도별 서비스·쿼리 의미/UI/인증 보존은 [AGENTS.md](AGENTS.md#supabase-의존성-규칙)를 따른다. 서비스 사용 예:

```ts
import * as Services from "../services";

const { data, error } = await Services.DatabaseService
  .select("products", "*, inventory(*)")
  .eq("store_id", currentStoreId)
  .eq("is_active", true);
```

직접 호출 잔여 확인:

```bash
rg "import \\{ supabase \\}|supabase\\." src admin-console
```

## 데이터베이스 변경

- 새 스키마 변경은 `supabase/migrations/`에 새 파일로 추가한다.
- 이미 존재하는 migration은 수정하지 않는다.
- 변경 전후에 `src/types/supabase.ts`와 `src/types/domain.ts`를 맞춘다.
- 배포 전 `npx supabase migration list --linked`로 로컬·원격 이력을 비교한다.
- RLS, policy, security-definer RPC는 매장 범위와 역할 검증을 함께 확인한다.

> **확인 필요:** 아래 범위·진행 상태는 2026-08-13 기록이다. 현재는 `060` 이후 파일과 `059_security_data_protection.sql`의 Git 이력이 있다. 원격 적용 여부는 미확인이다.

로컬에는 `001`부터 `059`까지 migration 파일이 있다. `059_security_data_protection.sql`은 현재 작업 트리의 진행 중 변경이므로 원격 적용 여부를 문서만 보고 판단하면 안 된다.

## Capacitor 앱

`capacitor.config.json`은 다음 로컬 번들 방식을 사용한다.

```json
{
  "appId": "com.jinkim.stockly",
  "appName": "Stockly",
  "webDir": "dist"
}
```

`server.url`이 없으므로 설치된 앱은 Vercel 화면이 아니라 앱 안의 `dist`를 사용한다. 웹 코드를 기기에 반영하려면 새로 빌드하고 native project에 복사한 뒤 다시 설치하거나 TestFlight 빌드를 올려야 한다.

### iPhone Live Reload (Stockly Dev)

- Xcode `App` scheme **Debug**는 `com.jinkim.stockly.dev` / **Stockly Dev**, **Release**는 기존 `com.jinkim.stockly` / **Stockly**다. 직원용 `Stockly Staff`는 별도다. Debug만 Tailnet HTTPS 주소를 사용한다.
- Mac에서 `npm run dev:device`를 실행한다. staging Supabase 값이 production과 같으면 실행을 중단한다. Vite는 `127.0.0.1:5173`만 듣고 Tailscale Serve가 Tailnet 전용 `https://macmini-1.tailc45cff.ts.net:8443`으로 연결한다. iPhone도 같은 Tailnet에 연결해야 한다.
- Mac에 페어링된 iPhone에 개발 서명으로 재설치할 때는 **`npm run ios:install:dev`만 사용**한다. 기기가 여러 대면 `npm run ios:install:dev -- --device <UDID>`로 선택한다. staging 빌드·복사 → 개발용 `?mode=developer` 서명 → 실제 앱의 Bundle ID/NFC TAG/개발 프로파일/대상 기기/Dev 서버/번들 검증 → 설치 → 버전 및 실행 확인을 순서대로 수행하며 검증 실패 시 설치를 중단한다. 빌드 번호는 설치된 앱·Xcode 설정·기존 개발 설치 폴더보다 높은 번호로 자동 선택한다. 공유 Firebase/Release entitlement는 변경하지 않는다. iPhone의 `연결된 도메인 개발` 설정은 별도 활성화가 필요하며 실제 NFC 태그 성공은 기기에서 확인한다. 회귀 검증은 `python3 tests/ios-dev-install.test.py`다.
- Xcode에서 `App` scheme / Debug / 실제 iPhone을 선택해 한 번 설치한다. 이후 React/TS/CSS 수정은 HMR로 반영된다. Swift, Info.plist, 플러그인, signing 변경은 다시 빌드·설치해야 한다. 개발용 Bundle ID의 개발 서명·기기 등록과 staging OAuth 리디렉션/Apple Client ID는 실기기 확인 전 별도 설정이 필요하다.
- 서버 자동 재시작용 LaunchAgent `~/Library/LaunchAgents/com.stockly.dev-server.plist`가 활성화돼 있다. `launchctl print gui/$(id -u)/com.stockly.dev-server`로 상태를 확인한다. Mac/Tailscale이 꺼져 있으면 iPhone 앱은 원격 화면을 열 수 없다.
- 근태관리의 태그별 `테스트`는 staging 앱의 테스트 매장 관리자만 사용한다. `094`·`095` 마이그레이션 후에도 DB 게이트는 기본적으로 꺼져 있으며, 승인된 staging DB에서만 `insert into stockly_private.attendance_tag_test_enabled default values;`로 켠다. 운영 DB에는 적용하지 않는다. 실제 NFC 대신 출퇴근 입력 흐름을 시작하며 확정하면 staging 근태 기록이 남는다.
- NFC 품목·출퇴근 태그는 staging에서 Dev 전용 경로(`/nfc/dev/product/…`, `/attendance/dev/tag/…`)를 기록한다. Dev 서명에 `applinks:stroage-manage.vercel.app`과 공개 AASA의 Dev 앱 ID가 모두 필요하다. 권한 변경은 HMR로 적용되지 않으므로 Dev 앱을 다시 설치하고 AASA도 웹에 배포해야 한다. 기존 일반 경로 태그는 Dev에서도 해석하며, AASA의 Dev 항목은 운영 앱 뒤에 둔다. Dev·운영 앱을 함께 설치했다면 기존 태그를 Dev 전용 경로로 다시 기록해야 대상 앱을 확실히 구분할 수 있다. iPhone은 NFC 알림을 눌러 앱을 열며, 품목은 해당 재고 작업 화면, 출퇴근은 로그인 확인 후 기존 시간 입력·확정 흐름을 사용한다. 물리 태그 검증은 앱 종료/실행 중 각각 수행한다.
- 배포 전 `npm run build && node --test tests/production-supabase-bundle.test.mjs tests/device-dev-config.test.mjs && npx cap sync ios`로 production bundle을 복사한다.

### 야외 네이티브 업데이트 (Ad Hoc)

`Stockly Dev`만 대상으로 한다. 웹 변경은 위 Live Reload를 사용하고 Swift·플러그인·권한 변경 시에만 새 IPA를 만든다. 사전 조건: Apple Developer에 `com.jinkim.stockly.dev` 명시적 App ID와 NFC 권한(필요한 경우), Apple Distribution 인증서, 테스터 iPhone UDID가 포함된 `com.jinkim.stockly.dev` Ad Hoc 프로비저닝 프로파일을 준비한다. App Store/직원용 프로파일은 사용할 수 없다.

```bash
STOCKLY_TEST_DEVICE_UDID=<등록된-iPhone-UDID> npm run ios:adhoc
# 생성·검증된 ~/Stockly-Dev-Distributions/export/*.ipa를 Firebase App Distribution에 업로드
npx --yes firebase-tools appdistribution:distribute ~/Stockly-Dev-Distributions/export/*.ipa --app <Firebase-iOS-App-ID> --testers <테스터-이메일>
```

`ios:adhoc`은 staging/production 분리 확인 → staging 웹 빌드 → Capacitor sync → **Debug** 앱 아카이브 → Ad Hoc 서명 IPA 내보내기 → Bundle ID·개발 서버 URL·기기 UDID·배포 서명을 확인한다. Firebase는 설치 파일 전달 수단이며 네이티브 코드를 실시간 갱신하지 않는다. Firebase 프로젝트의 iOS 앱 Bundle ID도 `com.jinkim.stockly.dev`여야 한다. 업로드 후 Firebase 콘솔에서 릴리스와 테스터 초대를 읽어 확인하고, iPhone Safari에서 초대를 수락해 설치한다. Firebase 프로젝트 `stockly-dev-d3c5b`의 iOS 앱 `com.jinkim.stockly.dev`에 iOS 27 UIScene 대응 Ad Hoc IPA 1.0.1 (99)을 기존 테스터 한 명에게 배포했다. 콘솔에서 수락됨 1명·다운로드 0건을 확인했으며 iOS 27 실기기 실행은 아직 검증하지 않았다. 이전 1.0.1 (98)은 다운로드 1건이었으나 iOS 27에서 실행 직후 종료가 보고됐고, 1.0.1 (97)은 iOS 26에서 iPhone 화면 렌더링을 확인했다.

```bash
npm run ios:prepare
npm run cap:ios
```

Android:

```bash
npm run build
npm run cap:sync
npm run cap:android
```

## 문서

- `AGENTS.md`: 저장소 작업 규칙과 기능별 불변 조건
- `docs/user-guide-ko.md`: 현재 고객용 앱 사용 안내
- `docs/agent-handoff.md`: 현재 구조와 미검증 범위 인수인계
- `docs/stockly-todo-list.md`: 통합 작업 목록
- `docs/multi-store-implementation.md`: 현재 다중 매장·초대코드 구조
- `docs/native-scanner-poc.md`: 현재 네이티브/웹 스캐너 구조와 검증법
- `docs/animation-implementation.md`: 애니메이션 적용 현황
- `docs/ios-staff-install.md`: Xcode 직접 설치 절차
- `docs/testflight-staff-deployment.md`: TestFlight 배포 절차
- `docs/security-hardening-deployment.md`: 보안 강화 단계별 배포·중단 게이트
- `docs/privacy-policy-ko.md`: 개인정보 처리 안내 초안
- `docs/windows-ai-agent-start-prompt.md`: Windows 개발 환경을 시작할 때 AI 에이전트에게 전달할 프롬프트

## 배포 원칙

배포는 사용자가 명시적으로 지시했을 때만 진행한다. 로컬 빌드 성공은 Vercel, Supabase, Edge Function, TestFlight 또는 실제 기기 동작을 증명하지 않으므로 각 검증 범위를 분리해서 보고한다.
