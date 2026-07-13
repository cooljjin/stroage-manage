# AGENTS.md

이 파일은 이 저장소에서 작업하는 AI 코딩 에이전트를 위한 운영 지침입니다. 새 에이전트는 작업을 시작하기 전에 반드시 이 파일과 `README.md`를 먼저 읽어야 합니다.

## 적용 범위

- 이 파일의 지침은 저장소 전체에 적용됩니다.
- 나중에 하위 디렉토리에 더 가까운 `AGENTS.md`가 추가되면, 해당 하위 파일의 지침이 그 범위 안에서 우선합니다.
- 사용자 요청이 이 파일과 충돌하면 사용자 요청을 우선하되, 위험하거나 기존 동작을 크게 바꾸는 경우에는 먼저 이유를 설명하고 확인합니다.

## 프로젝트 개요

이 프로젝트는 매장 재고 관리용 React/Vite 앱입니다. 현재는 Supabase를 백엔드로 사용하며, Vercel/PWA/Capacitor 앱 환경을 함께 고려합니다.

주요 기능:

- 이메일/비밀번호 및 OAuth 로그인
- 초대코드 기반 매장 편입
- 상품 등록/수정
- 재고 현황 조회
- 바코드 스캔
- 재고 작업: 입고, 출고, 이동, 조정, 메모
- 부족 재고 및 발주 관리
- 발주처 관리: 링크 발주, 문자 발주
- 카테고리/단위 관리
- 작업 로그와 복원
- 홈 대시보드: 할 일, 인수인계, 입고 확인
- 프랩 품목 관리와 프랩 모드
- 단체 주문 계산
- 직원/매장/master 관리

## 기술 스택

- React 18
- TypeScript
- Vite
- Tailwind CSS
- Supabase JS v2
- Capacitor iOS/Android
- PWA via `vite-plugin-pwa`
- Barcode scanning:
  - Native: `@capacitor-mlkit/barcode-scanning`
  - Web fallback: `html5-qrcode`
- Icons: `lucide-react`
- Animation: `motion`

## 주요 명령어

작업 후 기본 검증은 반드시 실행합니다.

```bash
npm run build
npm run lint
```

개발 서버:

```bash
npm run dev
```

Capacitor 관련:

```bash
npm run cap:sync
npm run ios:prepare
npm run cap:android
npm run cap:ios
```

주의:

- `npm run build`는 `dist/` 결과물을 갱신합니다.
- 빌드 산출물은 직접 손으로 수정하지 않습니다.
- 네이티브 sync나 iOS pod 설치는 로컬 권한/Xcode 상태에 따라 실패할 수 있습니다. 실패 원인이 코드가 아니라 로컬 환경 권한이면 그 사실을 명확히 보고합니다.

## 작업 기본 원칙

- 요청받은 범위만 수정합니다.
- UI, DB 구조, 인증 흐름, 라우팅, 쿼리 의미를 임의로 바꾸지 않습니다.
- 기존 동작 보존을 우선합니다.
- 큰 리팩토링보다 작은 변경을 선호합니다.
- 기존 파일의 스타일과 패턴을 따릅니다.
- 반복되는 쿼리나 로직을 정리할 때도 먼저 사용 범위를 확인합니다.
- 타입 안정성을 유지합니다. 가능한 한 `any`를 쓰지 않습니다.
- 사용자가 만들었을 수 있는 변경을 되돌리지 않습니다.
- 불필요한 포맷팅, 대규모 정렬 변경, 파일 전체 재작성은 피합니다.
- 수정 후 `npm run build`, `npm run lint`를 실행하고 결과를 보고합니다.

## 파일 탐색 원칙

- 텍스트 검색은 `rg`를 우선 사용합니다.
- 파일 목록은 `rg --files` 또는 `find`를 사용합니다.
- 수정 전에 관련 파일을 먼저 읽고 현재 흐름을 파악합니다.
- 한 파일의 일부만 보고 추측하지 말고, 상태/함수/렌더링이 이어지는 구간까지 확인합니다.

## Supabase 의존성 규칙

React 컴포넌트, 페이지, 훅, 일반 helper에서 Supabase 클라이언트를 직접 import하거나 직접 호출하지 않습니다.

금지:

```ts
import { supabase } from "../lib/supabase";

await supabase.from("products").select("*");
await supabase.auth.signOut();
await supabase.functions.invoke("delete-auth-user");
```

허용 범위:

- `src/lib/supabase.ts`
- `src/services/**`

서비스 계층:

- `src/services/auth/AuthService.ts`
- `src/services/database/DatabaseService.ts`
- `src/services/storage/StorageService.ts`
- `src/services/functions/EdgeFunctionService.ts`
- `src/services/errors.ts`
- `src/services/index.ts`

사용 예:

```ts
import * as Services from "../services";

await Services.AuthService.logout();

const { data, error } = await Services.DatabaseService.select("products", "*, inventory(*)")
  .eq("store_id", currentStoreId)
  .eq("is_active", true)
  .order("name", { ascending: true });

await Services.EdgeFunctionService.invoke("delete-auth-user", {
  body: { userId }
});
```

현재 `DatabaseService`는 Supabase의 fluent query 형태를 유지합니다. 따라서 서비스 계층 도입 때문에 기존 쿼리 의미가 바뀌면 안 됩니다.

직접 호출 잔여 확인:

```bash
rg "import \\{ supabase \\}|supabase\\." src
```

예외적으로 `src/lib/supabase.ts`와 `src/services/**` 안에서는 Supabase 직접 호출이 가능합니다.

## import 규칙

- 현재 프로젝트는 `@/` 같은 path alias를 사용하지 않습니다.
- 새 import는 기존처럼 상대 경로를 사용합니다.
- 서비스 import는 보통 다음 형태를 선호합니다.

```ts
import * as Services from "../services";
```

상황에 따라 `import { ProductOrderAction } from "../components/ProductOrderAction";` 같은 기존 직접 import 패턴을 유지합니다.

## DB와 마이그레이션 규칙

- 사용자가 명시하지 않으면 DB 구조를 바꾸지 않습니다.
- 스키마 변경이 필요할 때는 `supabase/migrations/`에 새 migration 파일을 추가합니다.
- 기존 migration을 수정하지 않습니다. 이미 적용됐을 수 있기 때문입니다.
- `src/types/supabase.ts`와 `src/types/domain.ts` 타입도 함께 맞춥니다.
- RLS/policy/RPC 변경은 앱 코드 영향 범위를 함께 확인합니다.
- Supabase SQL patch 파일이 `supabase/sql/`에 있지만, 새 변경은 migration 우선으로 생각합니다.

## 인증과 OAuth 규칙

인증은 `AuthService`를 통해서만 처리합니다.

현재 지원 흐름:

- 이메일/비밀번호 로그인
- 이메일/비밀번호 회원가입
- Google OAuth
- Kakao OAuth
- Apple OAuth 함수는 서비스에 남아 있을 수 있지만, UI 버튼은 현재 제거된 상태일 수 있습니다.

OAuth 네이티브 앱 콜백:

- 앱 전용 콜백 URL: `com.jinkim.storeinventory.poc://auth/callback`
- 웹에서는 `window.location.origin`을 redirect로 사용합니다.
- 네이티브에서는 Capacitor app URL open event로 OAuth callback을 받아 세션을 처리합니다.
- iOS URL scheme은 `ios/App/App/Info.plist`에 등록합니다.
- Android URL scheme은 `android/app/src/main/AndroidManifest.xml`와 `android/app/src/main/res/values/strings.xml`에 등록합니다.

Supabase 설정 시 유의:

- Supabase Auth Redirect URLs에 `com.jinkim.storeinventory.poc://auth/callback`을 등록해야 합니다.
- Google/Kakao 개발자 콘솔의 OAuth callback은 Supabase callback URL을 사용합니다.

```text
https://<project-id>.supabase.co/auth/v1/callback
```

OAuth provider scope를 바꿀 때는 실제 provider console 동의 항목과 일치시켜야 합니다.

## 초대코드와 매장 편입 규칙

현재 초대 방식은 이메일 링크 방식이 아니라 로그인 후 초대코드 입력 방식입니다.

흐름:

- 로그인 또는 회원가입
- 프로필이 없으면 매장 연결 화면 표시
- 사용자는 `새 매장 만들기` 또는 `초대코드 입력` 중 선택
- 초대코드 입력 성공 시 초대한 매장으로 계정 편입
- 새 매장 만들기 성공 시 현재 사용자는 해당 매장의 `store_admin`

관련 RPC:

- `create_store_invite(target_role)`
- `accept_store_invite_code(invite_code)`
- `create_personal_store(store_name)`

초대코드 공유:

- 초대 링크는 `/?inviteCode=CODE` 형태를 사용합니다.
- 앱은 URL의 `inviteCode`, `invite_code`, `code`를 읽어 로그인 후 자동 입력합니다.
- pending invite code는 localStorage에 저장될 수 있습니다.

규칙:

- 새 초대 기능에서 이메일을 요구하지 않습니다.
- 이미 매장에 소속된 계정은 다른 초대코드를 사용할 수 없습니다.
- 일반 직원은 초대코드를 만들 수 없습니다.

## 라우팅과 권한

주요 라우팅은 `src/App.tsx`, `src/types/domain.ts`, `src/lib/constants.ts`, `src/components/BottomNav.tsx`, `src/components/TopMenu.tsx`를 함께 확인합니다.

역할:

- `master`
- `store_admin`
- `staff`

권한이 걸린 화면을 변경할 때는 다음을 확인합니다.

- `App.tsx`에서 route 접근 제어
- `TopMenu`
- `BottomNav`
- 해당 페이지 내부 버튼 표시 조건

## 재고 모델 핵심

상품은 `products`, 수량은 `inventory`에 있습니다.

앱에서는 `normalizeInventoryItem`으로 다음 값을 계산합니다.

- `warehouse_qty`
- `store_qty`
- `total_stock`
- `is_low_stock`

`is_low_stock` 계산 규칙:

- `receipt_check_only` 품목은 자동 부족재고로 보지 않습니다.
- `status_enabled`가 켜져 있으면 `stock_status === "발주 필요"`가 부족재고입니다.
- 아니면 `total_stock <= minimum_stock`이면 부족재고입니다.

수량 표시는 `formatInventoryQuantity`를 사용합니다.

## 입고여부만 확인 품목 규칙

`receipt_check_only` 품목은 수량 관리를 하지 않고 입고 확인 로그만 남기는 특수 품목입니다.

중요 규칙:

- 재고 현황 화면에서도 발주 링크 버튼은 보여야 합니다.
- 재고 현황 화면에는 별도 `입고완료` 버튼을 두지 않습니다.
- 바코드 스캔 후에는 다른 품목과 동일하게 `재고 작업` 화면으로 이동합니다.
- 입고 완료 기록은 `recordReceiptCheckOnly(productId, storeId, quantity?)`를 사용합니다.
- 이 함수는 입고 로그를 남기고 `fresh_order_selected`, `urgent_order_requested`도 해제합니다.

관련 파일:

- `src/lib/receiptCheck.ts`
- `src/pages/InventoryOperationPage.tsx`
- `src/pages/InventoryListPage.tsx`
- `src/pages/ScanPage.tsx`
- `src/pages/LowStockPage.tsx`

## 바코드 스캔 규칙

스캔 화면: `src/pages/ScanPage.tsx`

스캔 흐름:

- Native scanner 사용 가능하면 native scanner 우선
- 실패하거나 fallback 필요 시 web scanner 사용
- 등록된 활성 상품이면 `재고 작업` 화면으로 이동
- 등록되지 않은 바코드면 상품 등록 화면으로 이동
- 보조 바코드는 `product_barcodes`에서도 조회
- 12자리/13자리 바코드는 앞자리 0 후보도 함께 확인

중요:

- 특정 상품 타입 때문에 스캔 후 이동을 막지 않습니다.
- `receipt_check_only` 품목도 스캔 후 `재고 작업` 화면으로 이동합니다.
- `PENDING_SCAN_STORAGE_KEY`는 native/web 전환 중 스캔 값을 잃지 않기 위한 장치입니다.
- `completedNavigationRef`, `barcodeHandlingRef`, `scanAttemptRef`는 중복 스캔과 중복 이동 방지용입니다. 수정 시 매우 조심해야 합니다.

## 재고 작업 화면 규칙

파일: `src/pages/InventoryOperationPage.tsx`

작업:

- 입고
- 출고
- 이동
- 조정
- 메모

입고 저장 시:

- `inventory` 수량 업데이트
- `inventory_logs` 로그 추가
- 발주품목 추가/긴급 상태인 상품이면 `fresh_order_selected`, `urgent_order_requested` 해제

입고여부만 확인 품목:

- 수량을 실제 재고에 더하지 않습니다.
- `recordReceiptCheckOnly`로 입고 확인 로그를 남깁니다.

복원/되돌리기:

- 로그 복원 로직은 수량 전후 값을 사용합니다.
- 관련 타입과 로그 필드(`warehouse_qty_before`, `store_qty_before`, `warehouse_qty_after`, `store_qty_after`)를 깨지 않도록 주의합니다.

## 부족 재고와 발주품목 규칙

파일: `src/pages/LowStockPage.tsx`

부족 재고 화면에 표시되는 품목:

- 자동 부족재고: 최소재고 이하 또는 상태 기반 `발주 필요`
- `fresh_order_selected`가 true인 품목
- `urgent_order_requested`가 true인 품목

역사적 이름:

- `fresh_order_selected`는 원래 신선식품 선택용 필드였지만, 현재는 "부족 재고 화면에 임의로 노출할 발주품목" 플래그처럼 사용합니다.
- DB 필드명을 당장 바꾸지 말고 기존 이름을 유지합니다.

발주품목 추가 팝업:

- 버튼 텍스트: `발주품목 추가`
- 검색어가 없으면 카테고리만 먼저 보여줍니다.
- 카테고리를 누르면 해당 카테고리의 품목 체크 목록이 나타납니다.
- 검색어가 있으면 카테고리 분류 없이 품목을 바로 보여줍니다.
- 각 품목에는 발주품목 체크와 `긴급` 체크가 있습니다.
- `긴급` 체크를 켜면 해당 품목은 자동으로 발주품목에 포함됩니다.
- 저장하면 `fresh_order_selected`, `fresh_order_selected_at`, `urgent_order_requested`, `urgent_order_quantity`가 반영됩니다.

긴급 표시:

- 긴급 수량이 있으면 `긴급 N개`
- 수량이 없으면 `긴급`
- 기존 긴급발주요청 별도 팝업은 제거된 상태입니다.

입고 완료:

- 발주품목 추가로 임의 노출된 품목은 입고 완료 시 목록에서 제거됩니다.
- 긴급 상태도 함께 해제됩니다.
- 자동 부족재고 품목은 실제 재고가 최소재고보다 높아져야 사라집니다.
- 자동 부족재고 품목에서 입고 완료를 누르면 실제 수량 처리를 위해 재고 작업 화면으로 이동합니다.

모바일 UI:

- `발주 완료` 체크박스와 `입고 완료` 버튼은 모바일 카드에서 가로로 `발주 완료 -> 입고 완료` 순서로 보여야 합니다.
- 버튼 텍스트가 넘치지 않도록 폭과 줄바꿈을 확인합니다.

## 재고 현황 화면 규칙

파일: `src/pages/InventoryListPage.tsx`

현재 규칙:

- 카테고리는 기본적으로 한 줄 가로 스크롤입니다.
- 오른쪽의 아래쪽 삼각형 버튼을 누르면 전체 카테고리가 여러 줄로 펼쳐집니다.
- 다시 누르면 접힙니다.
- `receipt_check_only` 품목도 발주 링크/문자 버튼을 보여야 합니다.
- `재고 현황` 화면에는 `입고완료` 버튼을 두지 않습니다.
- 발주 칸은 한 줄 정렬을 유지합니다.

## 발주 버튼 규칙

파일: `src/components/ProductOrderAction.tsx`

발주 방식:

- 발주처 `order_method === "link"`이면 상품 URL을 새 탭/외부 브라우저로 엽니다.
- 발주처 `order_method === "sms"`이면 수량 입력 후 문자 앱을 엽니다.

주의:

- 품목이 `receipt_check_only`이어도 발주 버튼을 숨기지 않습니다.
- 상품 URL이 없으면 링크 버튼은 disabled 상태입니다.
- SMS 발주처 전화번호가 없거나 수량이 없으면 문자 발주는 disabled 상태입니다.
- iOS SMS body separator는 `&`, 다른 환경은 `?`를 사용합니다.

## 홈 대시보드 규칙

파일: `src/pages/HomePage.tsx`

홈은 다음 데이터를 표시합니다.

- 대시보드 날짜
- 입고 로그 또는 입고 확인 품목
- 할 일
- 인수인계
- 삭제/복원 관련 상태

주의:

- 입고 확인/삭제/복원 관련 쿼리는 날짜 범위를 엄격히 다룹니다.
- store scope가 빠지지 않도록 확인합니다.

## 프랩과 단체주문 규칙

관련 파일:

- `src/pages/PrepItemManagementPage.tsx`
- `src/pages/PrepModePage.tsx`
- `src/pages/GroupOrderCalculatorPage.tsx`

주의:

- 단위 변환과 소수 수량이 중요합니다.
- `unit_weight`, `unit_weight_unit`, `processed_unit_weight`, `processed_unit_weight_unit`을 임의로 단순화하지 않습니다.
- 계산 결과가 재고와 연결되므로 수량 단위를 변경할 때는 관련 helper와 타입을 함께 확인합니다.
- 단체주문 날짜/기간 선택 UI는 모바일 터치 동작과 스크롤 잠금 로직이 포함되어 있으므로 신중히 수정합니다.

## UI/UX 규칙

기본 원칙:

- 기존 Tailwind 스타일 패턴을 유지합니다.
- 업무용 앱이므로 조용하고 실용적인 UI를 유지합니다.
- 장식적인 레이아웃이나 마케팅형 히어로를 만들지 않습니다.
- 카드 안에 카드가 중첩되는 구조를 피합니다.
- 버튼/입력/테이블이 모바일에서 겹치지 않도록 확인합니다.
- 텍스트가 버튼 안에서 잘리지 않게 합니다.
- 아이콘은 가능하면 `lucide-react`를 사용합니다.

공통 클래스:

- `.touch-button`: 터치 가능한 버튼의 기본 최소 크기
- `.icon-button`: 아이콘 버튼
- `.field`: 입력 필드
- `.panel`: 주요 패널

모바일 입력 확대 방지:

- `index.html` viewport에는 `maximum-scale=1.0`, `user-scalable=no`가 들어가 있습니다.
- `src/styles.css`에서 텍스트 입력류는 16px 이상으로 고정합니다.
- 새 input/select/textarea를 만들 때 이 전역 규칙을 깨지 않도록 합니다.

테이블:

- 모바일에서 열이 많으면 폭을 조정하거나 버튼 텍스트를 줄입니다.
- 숫자는 가능하면 `tabular-nums`를 유지합니다.
- 중요한 sticky header는 `top-[73px]` 패턴을 사용 중입니다.

상태 메시지:

- `StatusMessage`를 사용합니다.
- 성공/오류/정보 메시지는 기존 패턴을 따릅니다.

## Native/PWA 규칙

Capacitor 파일:

- `capacitor.config.json`
- `android/**`
- `ios/**`

주의:

- 웹에서만 되는 API와 앱 WebView에서 되는 API를 구분합니다.
- OAuth callback, barcode scanner, file/camera input은 네이티브 동작을 함께 고려합니다.
- `@capacitor/app`은 OAuth deep link callback 처리에 사용됩니다.
- `@capacitor-mlkit/barcode-scanning`은 native barcode scan에 사용됩니다.

PWA:

- `vite-plugin-pwa`가 build 때 service worker를 생성합니다.
- 캐시 영향 때문에 UI가 바뀌었는데 기기에서 안 바뀌는 경우 새 빌드/배포 후 앱 캐시를 의심합니다.

## 테스트와 검증

모든 코드 변경 후:

```bash
npm run build
npm run lint
```

Supabase 직접 호출 관련 작업 후:

```bash
rg "import \\{ supabase \\}|supabase\\." src
```

초대 링크/초대코드 관련 작업 후:

```bash
rg "accept_store_invite|get_store_invite_public|inviteToken|InviteAcceptPage" src
```

스캔/입고 관련 수동 확인:

- 등록된 일반 품목 바코드 스캔 -> 재고 작업 화면 이동
- 입고여부만 확인 품목 바코드 스캔 -> 재고 작업 화면 이동
- 등록되지 않은 바코드 스캔 -> 상품 등록 화면 이동
- 보조 바코드로 등록된 품목 스캔 -> 해당 상품으로 이동
- 입고 저장 후 부족 재고/긴급/발주품목 플래그가 기대대로 해제되는지 확인

부족 재고 관련 수동 확인:

- 최소재고 이하 품목 표시
- 발주품목 추가로 임의 선택한 품목 표시
- 긴급 체크 품목 표시
- 검색 시 카테고리 없이 품목 바로 표시
- 검색이 없을 때 카테고리 접기/펼치기 표시
- 입고 완료 후 목록 제거 조건 확인

OAuth 관련 수동 확인:

- 웹 로그인 후 앱으로 정상 복귀
- 네이티브 앱에서 Google/Kakao 로그인 후 앱 callback으로 복귀
- Supabase Redirect URLs에 native callback이 등록되어 있는지 확인

## 접근성/사용성 기본값

- 아이콘만 있는 버튼에는 `aria-label`과 `title`을 넣습니다.
- 버튼은 `type="button"`을 명시합니다. form submit 버튼만 `type="submit"`을 사용합니다.
- 클릭 가능한 행 안에 버튼이 있으면 버튼 클릭 시 `event.stopPropagation()`을 사용합니다.
- disabled 상태를 명확히 표시합니다.
- 입력 placeholder만으로 의미를 전달하지 말고 필요한 경우 label 또는 주변 텍스트를 유지합니다.

## 에러 처리 규칙

- 서비스 레이어는 Supabase error/network error를 정규화할 수 있는 구조를 유지합니다.
- 기존 화면은 `{ data, error }` 패턴을 많이 사용하므로 대규모 try/catch 전환을 하지 않습니다.
- 사용자에게 보여주는 메시지는 기존 한국어 톤을 유지합니다.
- DB migration이 필요한 오류는 가능하면 "데이터베이스 업데이트가 필요합니다." 식으로 안내합니다.

## 코드 스타일 규칙

- TypeScript 타입을 유지합니다.
- 불필요한 `any`를 쓰지 않습니다.
- `useCallback`, `useMemo`는 기존 패턴에 맞춰 필요한 곳에만 씁니다.
- React state는 기존 위치와 의미를 유지합니다.
- async handler에서는 `void someAsync()` 패턴을 기존처럼 사용합니다.
- 렌더링 조건이 복잡해질 경우 작게 helper를 만들 수 있지만, 과도한 추상화는 피합니다.
- 기존 파일에서 세미콜론은 대부분 사용하지 않습니다. 파일 스타일을 따릅니다.

## 금지 사항

- 요청 없이 DB 스키마 변경
- 요청 없이 Supabase 설정 변경
- 요청 없이 UI 전면 개편
- 요청 없이 라우팅 구조 변경
- 요청 없이 인증 흐름 변경
- React 코드에서 Supabase 직접 호출
- 빌드 산출물 직접 수정
- 사용자 변경 되돌리기
- 무관한 리팩토링
- 큰 포맷팅 변경

## 새 기능 추가 시 체크리스트

1. 같은 기능이 이미 있는지 `rg`로 검색합니다.
2. 관련 페이지와 helper를 읽습니다.
3. Supabase 접근이 필요하면 서비스 계층을 사용합니다.
4. 기존 타입을 확인하고 필요한 타입만 확장합니다.
5. 모바일 화면에서 텍스트/버튼/테이블 폭을 고려합니다.
6. 저장/삭제/복원 같은 데이터 변경은 store scope와 role scope를 확인합니다.
7. `npm run build`를 실행합니다.
8. `npm run lint`를 실행합니다.
9. 변경 사항과 검증 결과를 간결히 보고합니다.

## 현재 특히 조심해야 하는 파일

- `src/App.tsx`: 인증, 프로필 로딩, 매장 연결, 라우팅, OAuth callback이 모여 있습니다.
- `src/pages/ScanPage.tsx`: native/web scanner, 중복 이동 방지, pending scan 처리 로직이 복잡합니다.
- `src/pages/InventoryOperationPage.tsx`: 실제 재고 수량과 로그를 변경합니다.
- `src/pages/LowStockPage.tsx`: 부족재고, 발주품목 추가, 긴급, 입고완료 흐름이 결합되어 있습니다.
- `src/pages/GroupOrderCalculatorPage.tsx`: 날짜/레시피/단위 계산/주문 저장이 결합된 큰 파일입니다.
- `src/lib/receiptCheck.ts`: 입고여부만 확인 품목의 공통 기록 함수입니다.
- `src/lib/inventory.ts`: 재고 계산과 표시 포맷의 기준입니다.
- `src/services/**`: Supabase 의존성 격리의 핵심입니다.

## 보고 방식

작업 완료 보고에는 다음을 포함합니다.

- 무엇을 바꿨는지
- 주요 파일
- 동작이 어떻게 달라지는지
- `npm run build` 결과
- `npm run lint` 결과
- 하지 못한 검증이 있으면 이유

예:

```text
수정 완료했습니다.

- 재고현황 카테고리 오른쪽에 펼침 버튼 추가
- 기본은 한 줄 스크롤, 펼치면 여러 줄 전체 표시

확인 결과:
- npm run build 성공
- npm run lint 성공
```

## 사용자와의 협업 톤

- 한국어로 간결하고 명확하게 설명합니다.
- 기술적 결정에는 이유를 붙입니다.
- 필요 이상으로 장황하게 설명하지 않습니다.
- 문제가 있으면 숨기지 말고 원인과 영향 범위를 말합니다.
- "가능합니다"보다 "무엇을 어떻게 했는지"를 우선합니다.
