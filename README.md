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

지원 로그인:

- 이메일/비밀번호
- Google OAuth
- Kakao OAuth
- Apple OAuth

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

## 역할과 권한

- `master`: 별도 운영자 콘솔에서 전체 매장과 사용자를 관리
- `store_admin`: 본인 매장의 설정, 직원, 권한, 품목 기준정보를 관리
- `staff`: 재고 업무를 수행하며 필요한 관리 권한을 선택적으로 부여받을 수 있음

직원에게 선택적으로 부여할 수 있는 권한:

- 카테고리 관리
- 발주처 관리
- 메뉴 레시피 등록
- 발주 품목 확정

프런트엔드의 메뉴 숨김은 편의를 위한 것이고 실제 데이터 보호는 Supabase RLS와 RPC 검증이 담당해야 한다.

## Supabase 의존성 규칙

React 컴포넌트, 페이지, 훅, 일반 helper에서 Supabase 클라이언트를 직접 import하거나 호출하지 않는다.

```text
React Component / Hook / Helper
        |
        v
src/services
        |
        v
Supabase
```

허용되는 직접 접근 위치:

- `src/lib/supabase.ts`
- `src/services/**`

일반 코드는 서비스 계층을 사용한다.

```ts
import * as Services from "../services";

const { data, error } = await Services.DatabaseService
  .select("products", "*, inventory(*)")
  .eq("store_id", currentStoreId)
  .eq("is_active", true);
```

인증은 `AuthService`, 파일은 `StorageService`, Edge Function은 `EdgeFunctionService`를 사용한다. 서비스 계층으로 옮길 때 쿼리 의미, UI, 인증 흐름을 함께 바꾸지 않는다.

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
