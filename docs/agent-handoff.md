# Stockly 작업 인수인계

마지막 점검: 2026-08-13 로컬 작업 트리

이 문서는 다음 작업자가 현재 저장소 구조와 미검증 범위를 빠르게 파악하기 위한 요약이다. 운영 Supabase, Vercel, App Store Connect 상태는 이 문서만으로 확정하지 않는다.

## 프로젝트 위치와 구성

```text
/Users/jinkim/Documents/storage manage
```

- 고객용 React/Vite 앱: `src/`
- master 전용 운영 콘솔: `admin-console/`
- Supabase migration: `supabase/migrations/`
- Edge Functions: `supabase/functions/`
- Capacitor iOS/Android: `ios/`, `android/`
- 로컬 번들 디렉터리: `dist/`

현재 Git branch는 `main`이며 확인 당시 HEAD는 `e1f2091 Prepare App Store review build 6`이다. 이 값은 이후 변경될 수 있으므로 작업 시작 시 다시 확인한다.

## 작업 트리 보호

2026-08-13 점검 당시 다음 변경이 커밋되지 않은 상태였다.

- 계정 탈퇴 역할 검증 보완
- 재고 작업·입고 확인·발주 확정의 RPC 트랜잭션화
- 품목 단위의 매장 범위 분리
- `supabase/migrations/059_security_data_protection.sql`
- `docs/stockly-todo-list.md`
- `tmp/`

이 변경들은 사용자 작업으로 간주하고 되돌리거나 덮어쓰지 않는다. 새 작업 전 반드시 `git status --short`와 관련 diff를 확인한다.

## 현재 앱 구조

고객용 앱 라우팅은 React Router가 아니라 `src/App.tsx`의 route state와 navigation stack으로 관리한다.

하단 메뉴:

- 홈
- 재고현황
- 스캔
- 부족재고
- 작업로그

상단 메뉴:

- 프랩관리모드
- 프랩품목 관리
- 단체주문 계산
- 메뉴 레시피 등록
- 개별관리 품목
- To do list
- 카테고리 관리
- 품목 단위 관리
- 발주처 관리
- 직원 관리
- 권한 부여
- 환경설정

메뉴 노출은 역할과 `staff_permissions`에 따라 달라진다.

## 계정과 매장 연결

지원 로그인은 이메일/비밀번호, Google, Kakao, Apple이다. 로그인 후 프로필이 없으면 다음 중 하나를 선택한다.

- `create_personal_store(store_name)`: 새 매장 생성 후 `store_admin`으로 시작
- `accept_store_invite_code(invite_code)`: 관리자가 생성한 8자리 코드로 참여

관리자는 `create_store_invite(target_role)`로 `staff` 또는 `store_admin` 코드를 만든다. 이메일을 받거나 이메일이 일치해야 하는 구조가 아니다.

공유 링크는 `/?inviteCode=CODE` 형식이며 앱은 `inviteCode`, `invite_code`, `code`를 읽는다. 현재 매장에 이미 연결된 계정은 다른 초대코드를 사용할 수 없다.

## master 운영 콘솔

고객용 앱에서 `master`는 `MasterAccountBlockedPage`로 이동하며 매장 기능을 사용할 수 없다. 전체 매장·사용자 관리는 별도 `admin-console`에서 수행한다.

운영 콘솔의 현재 기능:

- master 이메일/비밀번호 로그인
- 전체 매장 조회와 새 매장 생성
- 전체 사용자 조회
- 사용자 이름과 배정 매장 수정
- 사용자 삭제
- 초대코드와 `?inviteCode=` 공유 URL 생성

현재 제한:

- 매장 이름·상태 수정 UI 없음
- 사용자 역할 변경 UI 없음
- 운영 콘솔 초대 UI에 대상 매장 선택이 없음. RPC는 현재 master 프로필의 `store_id`를 기준으로 동작하므로 실제 운영 사용 전 범위를 다시 확인해야 한다.

## 재고와 발주 핵심 흐름

- 상품 정보: `products`
- 위치별 수량: `inventory`
- 작업 기록: `inventory_logs`
- 보조 바코드: `product_barcodes`
- 확정 발주: `confirmed_order_items`

`normalizeInventoryItem`이 창고·매장·총재고와 부족 여부를 계산한다.

부족 재고 표시 조건:

- 수량 기반: `total_stock <= minimum_stock`
- 상태 기반: `status_enabled`일 때 `stock_status === "발주 필요"`
- 수동 발주 추가: `fresh_order_selected`
- 긴급: `urgent_order_requested`

`receipt_check_only` 품목은 자동 수량 부족 대상이 아니며 수량 대신 입고 완료 로그만 남긴다. 스캔 후에도 일반 품목과 동일하게 재고 작업 화면으로 이동한다.

## 현재 진행 중인 보안·데이터 변경

로컬 `059_security_data_protection.sql`과 관련 앱 코드는 다음을 목표로 한다.

- `record_inventory_operation`: 재고 변경, 로그 기록, 발주 상태 정리를 원자적으로 처리하고 `inventory.updated_at`으로 동시 수정 충돌 감지
- `record_receipt_check`: 입고여부만 확인 로그와 발주 상태 정리를 원자적으로 처리
- 발주 확정 목록 교체·추가·삭제·취소 RPC
- `product_units.store_id`와 매장별 RLS
- `rename_product_unit` RPC
- 일반 직원 탈퇴 시 본인 계정만 삭제하고 관리자 이관을 허용하지 않음

이 변경은 로컬 소스에 존재하지만 다음은 별도 확인이 필요하다.

- migration 059의 원격 적용 여부
- `manage-account-deletion` Edge Function 재배포 여부
- 실제 두 계정 동시 재고 작업
- 발주 확정·수정·취소 후 `confirmed_order_pending` 일치
- 매장 간 품목 단위 격리

## 특히 조심할 파일

- `src/App.tsx`: 인증, 프로필, 초대코드, route stack, native callback
- `src/pages/ScanPage.tsx`: native/web 스캔과 중복 이동 방지
- `src/pages/InventoryOperationPage.tsx`: 실제 재고와 로그
- `src/pages/LowStockPage.tsx`: 발주 추가, 긴급, 컨펌, 확정 목록
- `src/pages/HomePage.tsx`: 영업일, 입고, To do, 인수인계
- `src/pages/GroupOrderCalculatorPage.tsx`: 일정, 레시피, 단위 계산
- `src/lib/receiptCheck.ts`: 입고여부만 확인 공통 기록
- `src/services/**`: Supabase 의존성 경계

## 개발과 검증

```bash
npm ci
npm run build
npm run lint
```

운영 콘솔을 변경했다면:

```bash
npm run build:admin
```

`npm run lint`가 생성물 때문에 실패하면 원인을 분리하고 소스 검증도 실행한다.

```bash
npx eslint src admin-console
```

Supabase 직접 호출 잔여:

```bash
rg "import \\{ supabase \\}|supabase\\." src admin-console
```

초대코드 흐름:

```bash
rg "create_store_invite|accept_store_invite_code|create_personal_store|inviteCode" src admin-console supabase/migrations
```

## 검증 경계

빌드와 lint가 성공해도 다음은 증명되지 않는다.

- 실제 브라우저 화면과 뒤로가기·스크롤 복원
- iOS/Android 카메라와 OAuth callback
- 운영 Supabase migration/RLS/RPC 상태
- Edge Function 배포와 secret
- Vercel 최신 배포
- TestFlight/App Store Connect 상태

운영 데이터를 이용한 검증은 명시적으로 허용된 테스트 매장과 이름에 `테스트`가 포함된 품목으로 제한한다.

## 배포

배포는 사용자가 명시적으로 지시했을 때만 진행한다. 배포 요청이 없으면 로컬 변경, 정적 검증, 필요한 migration·배포 절차 준비까지만 수행한다.
