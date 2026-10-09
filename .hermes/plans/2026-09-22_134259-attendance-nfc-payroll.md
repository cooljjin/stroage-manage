# NFC 근태·급여 관리 Implementation Plan

> **For Hermes:** 구현 시 TDD로 각 작업을 순서대로 진행하고, DB 권한 계약 검토 후 UI를 연결한다.

**Goal:** 직원이 매장 NFC 스티커를 태그한 실제 시각을 보존한 뒤 급여에 반영할 출·퇴근 시각을 직접 입력하게 하고, 입력 시각과 근무 일정을 기준으로 연장·야간·휴일근로 및 법정수당 후보를 계산하며, 관리자와 근태관리 권한을 받은 직원만 두 시각과 급여 정보를 조회·관리·엑셀 내보내기할 수 있게 한다.

**Architecture:** 기존 `store_admin + staff_permissions` 모델을 재사용한다. 별도 `manager` 역할을 추가하지 않고 `attendance_management` 권한을 받은 `staff`를 매니저로 취급한다. NFC 링크 수신 시 서버가 변경 불가능한 태그 시각을 먼저 저장하고, 전역 입력 화면에서 직원이 급여 반영 시각을 제출하면 두 번째 RPC가 출근/퇴근을 확정한다. 급여·연장근무 계산은 직원 입력 시각을 사용하되 관리 화면에는 NFC 태그 시각, 입력 시각, 차이를 함께 표시한다.

**Tech Stack:** React 18, TypeScript, Vite, Capacitor 8 App URL listener, Supabase PostgreSQL/RLS/RPC, 기존 `xlsx` 패키지, iOS Universal Links, Android App Links.

---

## 확정할 기본 해석

- 현재 역할은 `master | store_admin | staff`뿐이다. 스키마에 새 `manager` 역할을 퍼뜨리지 않고 기존 선택 권한에 `attendance_management`를 추가한다.
- 일반 직원은 근태 메뉴·기록·급여·NFC 설정을 볼 수 없다. NFC 태그 후 본인의 급여 반영 출근/퇴근 시각을 입력하고 처리 결과만 확인한다.
- `NFC 태그 시각`은 휴대폰 시각이 아니라 DB의 `now()`로 변경 불가능하게 저장한다. 직원이 기입한 시각은 별도의 `급여 반영 시각`으로 저장하며 원본을 덮어쓰지 않는다.
- 급여와 연장·야간·휴일 구간은 급여 반영 시각을 기준으로 계산한다. 예: 14:55 또는 15:10에 NFC를 태그한 직원이 `15:00`을 입력하면 급여 계산 출근은 15:00이고, 관리자는 태그 시각과 15:00을 모두 본다.
- 직원 입력은 `<input type="time">`을 사용하고 분 단위로 받는다. 예정 시간이 있으면 해당 출근/퇴근 시간을 기본값으로 제시하되 직원이 확인·변경 후 저장한다.
- 태그만 하고 시각 입력을 끝내지 않은 건은 출퇴근으로 확정하지 않고 `입력 대기`로 남긴다. 앱을 다시 열면 유효한 대기 건을 복원하고, 만료된 건은 관리자 확인 대상으로 표시한다.
- NFC 스티커 한 장은 한 매장에 귀속된다. 토큰은 원문 저장 대신 해시 저장하고, 비활성화·재발급할 수 있게 한다.
- NFC는 매장 내부 편의 기능으로 먼저 운영한다. 정적 태그 복제·원격 사용 방지는 1차 범위에서 제외하고, 문제가 확인될 때 위치 확인 또는 회전형 코드를 추가한다.
- 앱 내부에서 물리 스티커를 직접 쓰는 기능은 1차 범위에서 제외한다. 관리 화면은 태그용 HTTPS 링크 생성·복사·교체를 제공하고, 스티커 기록은 범용 NFC Writer 앱으로 1회 수행한다. 전용 NDEF 쓰기 플러그인은 실제 운영에서 이 과정이 병목일 때만 추가한다.
- 근무시간은 `퇴근 - 출근 - 무급휴게분`으로 계산한다. 열린 근무는 급여 합계에서 제외하고 오류 상태로 표시한다.
- 주휴수당은 출퇴근 기록만으로 개근 여부를 정확히 판정할 수 없다. 직원별 `주 소정근로시간`을 저장하고, 주별 지급대상 여부는 관리자/매니저가 확인한다. 확인된 주만 `min(주 소정근로시간 / 40 × 8, 8) × 해당 시급`으로 계산한다. 실제 적용 전 노무 기준 확인이 필요하다.
- 연장근무 시간대를 자동으로 알기 위해 직원별 주간 반복 근무 일정과 날짜별 예외 일정을 등록한다. 직원이 확정한 급여 반영 출퇴근 시각이 일정을 벗어나면 `일정 외 근무 후보 HH:mm~HH:mm`로 자동 표시하고 관리자/매니저가 확정한다. 일정 외 근무와 법정 가산 대상 연장근로는 별도로 판정하며, NFC 태그 시각만으로 근무시간을 확정하지 않는다.
- 법정수당 계산은 기본급과 분리한다. `법정수당 포함` 체크를 끄면 기본급만, 켜면 확정된 주휴·연장·야간·휴일 가산수당을 합친 예상 급여를 보여준다. 원자료와 확정 상태는 체크박스와 무관하게 보존한다.
- 연장·야간·휴일 가산 적용 여부는 사업장 규모, 근로계약, 휴일 지정에 따라 달라질 수 있으므로 매장 급여 설정에 적용 기준과 기준 시행일을 저장하고 운영 전 노무 확인을 거친다. 법률값을 화면 코드에 흩어 쓰지 않는다.
- 금액은 원 단위 정수로 저장·계산하고, 화면/엑셀에서 원 단위 반올림 규칙을 한 곳에서 공유한다.

## 사용자 흐름

### 일반 직원

1. 로그인된 휴대폰으로 매장 NFC 스티커 태그.
2. 어느 화면에 있든 HTTPS 링크가 앱으로 전달됨.
3. 전역 처리기가 `begin_attendance_punch(tag_token, request_id)` RPC를 호출해 실제 NFC 태그 시각과 예상 동작(출근/퇴근)을 저장.
4. 현재 화면 위에 `출근 시간 입력` 또는 `퇴근 시간 입력` 화면을 표시. 예정 시간이 있으면 예: `15:00`을 기본값으로 넣음.
5. 직원이 급여에 반영할 `HH:mm`을 확인·수정하고 `출근 기록` 또는 `퇴근 기록` 버튼을 누름.
6. `finalize_attendance_punch(punch_id, entered_time)` RPC가 날짜를 안전하게 결합해 출근/퇴근을 확정.
7. `출근 15:00 기록됨 · NFC 태그 14:55`처럼 두 시각을 본인에게도 완료 메시지로 표시.
8. 동일 요청 재전송은 같은 대기 건/결과를 반환하고, 입력 완료 전 재태그는 기존 입력 화면을 다시 열어 중복 출퇴근을 만들지 않음.

### 관리자/매니저

1. 메뉴의 `근태 관리` 진입.
2. 기간·직원 필터로 `NFC 태그 시각`, `직원 입력 시각`, `차이`, 확정 상태를 함께 조회.
3. 직원별 반복 근무 일정과 날짜별 예외 일정을 등록·수정.
4. 누락/오입력 출퇴근, 실제 휴게시간, 메모를 수정. 수정 전후 값은 감사 로그에 남김.
5. 시스템이 직원 입력 시각과 일정을 비교해 `연장근무 후보 시작~종료`, 야간·휴일 구간을 자동 표시. NFC 태그 시각은 검토 자료로만 사용.
6. 관리자/매니저가 후보 구간과 주휴 지급대상을 확인·확정.
7. `법정수당 포함` 체크박스로 기본급과 수당 포함 예상급여를 즉시 전환해 비교.
8. `store_admin`만 시급·소정근로시간·수당 적용 기준을 수정하고, 매니저는 조회와 근태/수당 후보 확정만 수행.
9. `엑셀 다운로드`로 상세/직원별 요약 시트를 저장.
10. NFC 설정에서 태그 이름 변경, 비활성화, 토큰 재발급 링크 복사.

## 데이터 계약

새 migration: `supabase/migrations/092_nfc_attendance_payroll.sql`

### 테이블

- `attendance_tags`
  - `id`, `store_id`, `name`, `token_hash`, `is_active`, `created_by`, `created_at`, `updated_at`, `revoked_at`
  - `token_hash` unique, 원문 토큰 저장 금지.
- `attendance_punch_events`
  - `id`, `store_id`, `user_id`, `tag_id`, `request_id`, `punch_type`, `tagged_at`, `entered_at`, `status`, `finalized_at`, `expires_at`.
  - `tagged_at`은 RPC가 DB 서버 시간으로 생성하고 수정 불가. `entered_at`은 직원이 선택한 급여 반영 시각이며 `pending/finalized/expired` 상태를 분리.
  - `(user_id, request_id)` unique로 재전송을 멱등 처리하고, 직원은 본인의 pending 건을 최종 확정하는 RPC만 실행 가능.
- `attendance_shifts`
  - `id`, `store_id`, `user_id`, `check_in_at`, `check_out_at`, `check_in_punch_id`, `check_out_punch_id`, `unpaid_break_minutes`, `schedule_snapshot`, `note`, `created_at`, `updated_at`, `updated_by`
  - `check_in_at/check_out_at`은 직원 입력 또는 관리자 수정으로 확정된 급여 반영 시각. 원본 NFC 태그 시각은 연결된 punch event에 별도 보존.
  - 사용자별 열린 근무는 하나만 허용하는 partial unique index.
  - `check_out_at > check_in_at`, 휴게분 음수 금지.
- `attendance_work_schedules`
  - `id`, `store_id`, `user_id`, `weekday`, `scheduled_start_time`, `scheduled_end_time`, `break_start_time`, `break_end_time`, `effective_from`, `effective_to`.
  - 직원의 반복 근무 일정을 적용기간 이력으로 보관.
- `attendance_schedule_overrides`
  - `id`, `store_id`, `user_id`, `work_date`, `scheduled_start_at`, `scheduled_end_at`, `break_start_at`, `break_end_at`, `is_day_off`, `note`.
  - 휴무·대체근무·일시적인 시간 변경만 저장하고 반복 일정은 복제하지 않음.
- `attendance_shift_segments`
  - `id`, `shift_id`, `store_id`, `segment_start_at`, `segment_end_at`, `is_schedule_overrun`, `is_statutory_overtime`, `is_night`, `is_holiday`, `status`, `confirmed_by`, `confirmed_at`.
  - 퇴근 시 자동 산출한 구간을 `candidate`로 저장하고 관리자가 `confirmed/rejected`로 확정. 일정 외 근무라도 법정 가산 대상이 아닐 수 있으며, 한 구간에 연장·야간·휴일 속성이 겹칠 수 있음.
- `attendance_pay_rates`
  - `id`, `store_id`, `user_id`, `hourly_wage`, `weekly_contracted_hours`, `effective_from`, `effective_to`, `created_by`, timestamps.
  - 기간 중복을 막고 과거 급여가 현재 시급 변경으로 바뀌지 않게 적용일 이력을 유지.
- `attendance_weekly_allowances`
  - `store_id`, `user_id`, `week_start`, `eligible`, `confirmed_by`, `confirmed_at`, `note`.
  - 미확인 주는 급여 합계에 포함하지 않고 `확인 필요`로 표시.
- `attendance_shift_audit`
  - `shift_id`, `store_id`, `changed_by`, `changed_at`, `before_data`, `after_data`, `reason`.
  - 앱 직접 쓰기 금지, 관리 RPC에서만 생성.
- `attendance_payroll_rules`
  - `store_id`, `effective_from`, `workplace_rule`, `overtime_multiplier`, `night_multiplier`, `holiday_multiplier`, `holiday_over_eight_multiplier`, `rounding_rule`, `confirmed_by`, timestamps.
  - 적용 법령/사업장 기준을 시행일 이력으로 보관. 기본값은 제공하되 생산 적용 전 관리자가 확인해야 활성화됨.

### RPC

- `begin_attendance_punch(tag_token text, request_id uuid)`
  - 로그인, 사용자 매장, 활성 태그 해시를 검증하고 DB `now()`를 `tagged_at`으로 저장.
  - 열린 근무와 기존 pending 건을 잠근 뒤 출근/퇴근 유형을 결정하고 입력 대기 건을 반환.
  - 같은 request ID 또는 입력 완료 전 재태그는 새 이벤트를 만들지 않고 기존 대기 건을 반환.
- `finalize_attendance_punch(punch_id uuid, entered_time time)`
  - 본인 소유·미만료 pending 건인지 검사하고, 매장 시간대와 근무 일정/열린 근무를 사용해 `entered_time`에 안전한 날짜를 결합.
  - 출근은 당일 서비스 날짜, 야간 퇴근은 열린 출근 이후 가장 가까운 유효 날짜로 해석.
  - 입력 시각이 태그 시각에서 비정상적으로 멀거나 퇴근이 출근보다 빠르면 저장하지 않고 관리자 수정 안내.
  - punch를 finalized로 바꾸면서 shift 생성/종료를 같은 transaction에서 수행하고, 재호출은 기존 결과를 반환.
- `list_attendance_management(target_from date, target_to date, target_user_id uuid default null)`
  - `can_manage_store_task(store_id, 'attendance_management')` 검사 후 NFC 태그 시각, 직원 입력 시각, 분 차이, pending/expired 입력 누락, 근무·직원·적용 시급·주휴 확인 상태를 반환.
- `update_attendance_shift(...)`
  - 관리자/매니저 권한 검사, 매장 범위 검증, 감사 로그와 함께 원자적으로 수정.
- `save_attendance_work_schedule(...)` / `save_attendance_schedule_override(...)`
  - 반복 일정과 날짜별 예외를 저장하고 겹치는 적용기간을 거부.
- `recalculate_attendance_segments(shift_id uuid)`
  - 근무 당시 일정 snapshot과 매장 급여 기준으로 연장·야간·휴일 구간을 다시 계산하고 `candidate`로 저장.
- `confirm_attendance_segments(shift_id uuid, decisions jsonb)`
  - 관리자/매니저가 자동 후보를 확정/제외. 확정 전 구간은 급여 합계에 포함하지 않음.
- `save_attendance_pay_rate(...)`
  - `store_admin`만 실행 가능하며 적용기간 중복 검증.
- `save_attendance_payroll_rules(...)`
  - `store_admin`만 실행 가능하며 시행일·사업장 적용 기준·가산율·반올림 규칙 검증.
- `confirm_attendance_weekly_allowance(...)`
  - 주차와 대상자 검증 후 확인 기록.
- 태그 생성/이름 변경/비활성화/재발급 RPC
  - 새 토큰 원문은 생성/재발급 응답에서 한 번만 반환.

### RLS/권한

- 일반 직원: 모든 근태 테이블 직접 `SELECT/INSERT/UPDATE/DELETE` 금지. 본인 태그 시작/최종 확정 RPC만 실행 가능하며 다른 직원·과거 punch를 지정할 수 없음.
- 관리자/`attendance_management`: 본인 매장 범위에서 관리 RPC와 필요한 읽기만 허용.
- 시급·주휴·급여 데이터는 UI 숨김뿐 아니라 RLS/RPC에서 차단.
- `authenticated`의 직접 테이블 쓰기 권한은 부여하지 않고 RPC만 grant.
- 기존 `staff_permissions.permission_key` check constraint에 `attendance_management` 추가.

## 구현 작업

### Task 1: NFC/App Link 가능성 검증 스파이크

**Objective:** 본 기능을 만들기 전에 직원 배포용 iPhone과 Android에서 NDEF HTTPS 태그가 앱 URL 이벤트까지 들어오는지 확인한다.

**Files:**
- Modify: `ios/App/App/AppRelease.entitlements`
- Modify: `android/app/src/main/AndroidManifest.xml`
- Create: `public/apple-app-site-association`
- Create: `public/.well-known/assetlinks.json`
- Temporary test hook only: `src/App.tsx`

**Steps:**
1. 실제 서비스 HTTPS 도메인, Apple Team ID, 개발용/직원용 앱 Bundle ID, Android signing SHA-256을 확보한다.
2. AASA에 `com.jinkim.stockly`와 `com.jinkim.storeinventory.poc` 두 채널을 명시하고 `applinks:<domain>` entitlement를 추가한다.
3. Android `VIEW` HTTPS intent filter와 asset links를 추가한다.
4. NDEF URL `https://<domain>/attendance/tag/<test-token>`을 스티커에 기록한다.
5. 앱 foreground/background/종료 상태에서 실기기 태그 후 `appUrlOpen` 수신값을 확인한다.
6. iOS는 화면 잠금 상태에서 완전 무동작 처리를 보장하지 않으며 NFC 알림 탭이 필요할 수 있음을 실제 기기로 기록한다.

**Gate:** 직원 배포용 iPhone에서 URL 이벤트 수신이 확인되지 않으면 DB/UI 구현 전에 중단하고, `앱 내 NFC 스캔 버튼(Core NFC 세션)`으로 요구사항을 조정한다.

### Task 2: 권한·근태 DB 계약 추가

**Objective:** 클라이언트가 우회할 수 없는 기록·급여 보안 경계를 만든다.

**Files:**
- Create: `supabase/migrations/092_nfc_attendance_payroll.sql`
- Create: `supabase/tests/092_nfc_attendance_payroll_contract.sql`
- Modify: `src/types/supabase.ts`
- Modify: `src/types/domain.ts`

**TDD:**
1. SQL contract에 테이블/RLS/partial unique index/RPC 존재, 일반 직원 직접 쓰기 불가, 관리 권한의 매장 격리, 토큰 원문 비저장, `tagged_at` 수정 불가, 태그/입력 시각 분리, pending 만료, 시급 비공개, 일정 snapshot·수당 후보·확정 상태 보존을 먼저 작성한다.
2. 격리된 로컬 Supabase/Postgres에서 실패를 확인한다.
3. migration을 최소 구현한다.
4. contract를 다시 실행해 통과시킨다.
5. 생성된 계약에 맞춰 TypeScript 타입을 수동 동기화한다.

### Task 3: NFC 태그 원본 보존·입력 확정 RPC

**Objective:** 실제 NFC 태그 시각과 직원이 입력한 급여 반영 시각을 분리 보존하고, 두 단계 처리를 정확히 한 번만 확정한다.

**Files:**
- Modify: `supabase/migrations/092_nfc_attendance_payroll.sql`
- Modify: `supabase/tests/092_nfc_attendance_payroll_contract.sql`

**검증 사례:**
- 유효 태그 첫 호출 → 서버 태그 시각을 가진 `pending` 출근 이벤트, 아직 shift 없음.
- 14:55 태그 후 15:00 입력 → 태그 14:55 보존, 급여 반영 출근 15:00.
- 15:10 태그 후 15:00 입력 → 태그 15:10 보존, 급여 반영 출근 15:00.
- 예정 출근/퇴근 시간이 있으면 입력 화면 기본값으로 반환하되 자동 확정하지 않음.
- 같은 request ID 재호출 → 새 행 없이 같은 pending/완료 결과.
- 입력 완료 전 재태그 → 기존 입력 대기 건 반환, 출근 직후 퇴근으로 뒤집지 않음.
- pending 만료 → shift 미생성, 관리자 화면에 입력 누락 표시.
- 퇴근 입력은 열린 출근 이후 날짜로 결합하고 자정 넘김을 정확히 처리.
- 다른 사용자의 punch ID, 이미 완료된 값 변경, 비정상 범위 입력 → 거부.
- 비활성/다른 매장/조작 토큰 → 거부.
- 동시 시작/확정 → 중복 punch나 열린 근무가 두 개 생기지 않음.
- 관리자 수정 후에도 원본 `tagged_at`은 변경되지 않음.

### Task 4: 전역 NFC URL·시간 입력 화면

**Objective:** 로그인 후 어떤 앱 화면에서도 태그 링크를 처리하고 현재 화면 위에 급여 반영 시각 입력 화면을 표시한다.

**Files:**
- Create: `src/lib/attendanceLink.ts`
- Create: `src/components/AttendancePunchPrompt.tsx`
- Create: `tests/attendance-link-handler.test.mjs`
- Modify: `src/App.tsx`

**Steps:**
1. HTTPS 경로에서 토큰을 엄격히 파싱하고 허용 도메인/경로 외 URL은 무시하는 테스트를 작성한다.
2. cold start의 `window.location.pathname`과 native `appUrlOpen`을 같은 handler로 연결한다.
3. 로그인 전 링크는 토큰을 짧은 TTL로 로컬 보관하고 로그인 완료 후 한 번 처리한다. 처리 후 즉시 삭제한다.
4. `crypto.randomUUID()` request ID와 함께 begin RPC를 호출하고 반환된 punch를 전역 prompt 상태에 저장한다.
5. native `<input type="time">`에 예정 시각 또는 태그 시각을 기본값으로 표시하고 `출근 기록`/`퇴근 기록` 명시 버튼으로만 finalize한다.
6. 입력 화면을 닫거나 앱이 종료돼도 유효한 pending punch를 다음 실행에서 복원한다.
7. 확정 후 `급여 반영 15:00 · NFC 태그 14:55` 완료 메시지를 표시하고, 진행 중 중복 이벤트와 이중 submit을 막는다.

### Task 5: 근태 관리 메뉴·라우트 추가

**Objective:** 관리자와 매니저에게만 관리 화면 진입점을 노출한다.

**Files:**
- Modify: `src/types/domain.ts`
- Modify: `src/lib/staffPermissions.ts`
- Modify: `src/components/TopMenu.tsx`
- Modify: `src/routes/lazyPages.ts`
- Modify: `src/App.tsx`
- Modify: `src/pages/StaffPermissionsPage.tsx` (기존 옵션 배열 재사용으로 실제 변경은 최소)
- Create: `src/pages/AttendanceManagementPage.tsx`
- Create: `tests/attendance-access.test.mjs`

**Steps:**
1. `attendance-management` route와 `attendance_management` 권한을 타입/옵션에 추가한다.
2. `store_admin` 또는 해당 권한 보유자에게만 메뉴를 표시한다.
3. `App.canAccess`도 동일 조건으로 막아 URL/상태 조작 우회를 차단한다.
4. 페이지에 기간·직원 필터, `NFC 태그 시각 / 급여 반영 시각 / 차이` 열, 입력 누락 경고, 상세 근무표, 열린 근무 경고, 수정 폼, 주휴 확인, 급여 요약, NFC 설정을 기존 `panel/field/StatusMessage` 패턴으로 배치한다.
5. 일반 직원 DOM에 시급/급여/태그 관리 요소가 렌더되지 않는 소스 계약 테스트를 남긴다.

### Task 6: 근무 일정·법정수당 계산·확정

**Objective:** 직원이 입력한 급여 반영 출퇴근과 당시 근무 일정을 비교해 연장·야간·휴일 구간을 자동 검출하고, 확정된 구간만 급여에 반영한다.

**Files:**
- Modify: `src/pages/AttendanceManagementPage.tsx`
- Create: `src/lib/attendancePayroll.ts`
- Create: `tests/attendance-payroll.test.mjs`
- Modify: `src/types/domain.ts`

**TDD 사례:**
- 자정 넘김 근무와 기간 경계.
- 열린 근무 제외.
- 급여 계산과 일정 외 근무 판정은 NFC 태그 시각이 아니라 확정된 직원 입력 시각 사용.
- 직원 입력 시각을 관리자가 수정해도 원본 NFC 태그 시각은 그대로 유지되고 감사 로그에 전후 값 저장.
- 태그/입력 시각 차이를 부호 있는 분 단위로 계산하고 필터 가능.
- 무급휴게분 차감 및 근무시간보다 큰 휴게분 거부.
- 급여 반영 퇴근이 일정 종료보다 늦으면 `일정 종료~급여 반영 퇴근` 연장근무 후보 생성.
- 급여 반영 출근이 일정 시작보다 빠르면 조기 출근 후보로 표시하되 확정 전 수당에 미포함.
- 날짜별 예외 일정이 반복 일정보다 우선.
- 일일·주간 기준을 넘는 시점이 근무 도중이면 그 시점부터 연장 구간 분할.
- 야간 기준시간을 가로지르면 정확한 시작·종료로 구간 분할.
- 기존 `weekly_store_closures`·`store_closure_dates`는 휴일근로 후보의 기본 자료로 재사용하되, 관리자 확정 전 수당에 미포함.
- 연장+야간 또는 휴일+야간처럼 속성이 겹치는 구간의 가산액을 매장 급여 규칙대로 합산.
- 퇴근 누락·비정상 장시간 근무는 연장근무로 자동 확정하지 않고 `확인 필요` 처리.
- 중간 시급 변경 시 각 근무일에 유효한 시급 적용.
- 소정근로시간 40시간 이하/초과 시 주휴시간 상한.
- 미확인 주휴는 총액에서 제외되고 `확인 필요` 집계.
- `법정수당 포함` 해제 시 기본급, 체크 시 기본급+확정 주휴+확정 가산수당 표시.
- 표시 체크 변경이 DB의 원기록·후보·확정 상태를 변경하지 않음.
- 원 단위 반올림이 화면/엑셀에서 동일.

**계산 결과:** `기본급`, `주휴수당`, `연장 가산`, `야간 가산`, `휴일 가산`, `수당 제외 예상급여`, `수당 포함 예상급여`를 분리해 반환한다. 수당 중복 적용은 저장된 급여 규칙의 유효기간 버전을 사용한다.

**대한민국 기본 계산 프로필:**
- 기본급은 확정된 급여 반영 유급근로시간 전체에 시급 1배를 적용한다.
- 법정 적용 대상일 때 연장근로와 야간근로(22:00~06:00)는 각각 추가 가산분을 분리 계산한다.
- 휴일근로는 8시간 이내/초과 구간을 분리하고, 연장·야간·휴일 조건이 겹치면 해당 추가 가산분을 각각 표시한다.
- 주휴수당은 주 소정근로시간과 소정근로일 개근 확인을 사용한다.
- 구체 가산율과 적용 여부는 `attendance_payroll_rules`의 시행일 버전에서 읽으며, 사업장 기준 확인 전에는 법정수당을 확정하지 않는다.

**UI 규칙:**
- 근태 행에 `NFC 태그 출근/퇴근`, `급여 반영 출근/퇴근`, 각각의 차이, 예정 출퇴근, `연장 HH:mm~HH:mm`, 야간/휴일 배지를 함께 표시한다.
- 자동 구간은 기본 선택된 후보로 보여주되 `확정` 전에는 급여에 넣지 않는다.
- `법정수당 포함` 체크박스는 조회 금액만 전환한다.
- 수정·후보 확정·제외에는 사유를 받아 감사 로그에 남기고, 저장 후 서버 재조회 결과로 갱신한다.

### Task 7: NFC 태그 관리

**Objective:** 관리자/매니저가 태그 링크를 안전하게 발급·교체·폐기한다.

**Files:**
- Modify: `src/pages/AttendanceManagementPage.tsx`
- Modify: `src/types/domain.ts`

**Steps:**
1. 태그 이름과 상태 목록을 표시한다. 저장된 토큰 원문은 다시 표시하지 않는다.
2. 생성/재발급 직후 한 번만 전체 HTTPS 링크를 보여주고 복사 버튼을 제공한다.
3. 재발급 시 기존 링크를 즉시 무효화한다.
4. 비활성화된 태그로 clock RPC가 실패하는 통합 계약을 확인한다.

### Task 8: 엑셀 내보내기

**Objective:** 승인된 기간의 상세와 직원별 급여 요약을 `.xlsx`로 내려받는다.

**Files:**
- Create: `src/lib/attendanceExport.ts`
- Create: `tests/attendance-export.test.mjs`
- Modify: `src/pages/AttendanceManagementPage.tsx`

**Implementation:** 이미 설치된 `xlsx`를 동적 import해 새 의존성을 추가하지 않는다.

**Workbook:**
- `근태상세`: 날짜, 직원, 예정 출퇴근, NFC 태그 출근/퇴근, 직원 입력 출근/퇴근, 태그 대비 차이(분), 무급휴게, 순근무시간, 연장 시작/종료, 야간 시작/종료, 휴일근로, 후보/확정 상태, 적용시급, 기본급, 수정메모.
- `급여요약`: 직원, 총근무시간, 기본급, 주휴수당, 연장 가산, 야간 가산, 휴일 가산, 수당 제외 합계, 수당 포함 합계, 미확정 후보 수, 주휴 미확인 주 수.
- 파일명: `근태기록_YYYY-MM-DD_YYYY-MM-DD.xlsx`.

**검증:** 권한 없는 계정은 보고서 RPC를 호출할 수 없고, 다운로드 데이터는 현재 매장·선택 기간만 포함하며, 화면의 체크 상태와 무관하게 엑셀에는 수당 제외/포함 합계를 모두 명시한다.

### Task 9: 전체 회귀·실기기 검증

**Commands:**

```bash
node --test tests/attendance-link-handler.test.mjs tests/attendance-access.test.mjs tests/attendance-payroll.test.mjs tests/attendance-export.test.mjs
npm run build
npx eslint src tests
npm run ios:prepare
npm run cap:sync
```

DB는 사용자가 승인한 격리 컨테이너에서만 migration과 `supabase/tests/092_nfc_attendance_payroll_contract.sql`을 실행하고, 기존 SQL contract도 별도로 회귀 실행한다. 실제/원격 DB에는 이 계획 단계와 로컬 검증 단계에서 접근하지 않는다.

**수동 검증:**
- 테스트 매장·Aside vault 테스트 계정만 사용.
- 관리자, 근태관리 권한 직원, 일반 직원 각각 메뉴/RPC 접근 확인.
- iPhone 직원 배포용 앱과 Android 실기기에서 foreground/background/cold start 태그.
- 빠른 연속 태그, 네트워크 끊김 후 재시도, 앱 로그인 만료, 비활성 태그.
- 14:55→15:00, 15:10→15:00 입력, 퇴근 시각 입력, pending 복원/만료, 자정 넘김 날짜 결합을 확인.
- 관리 화면과 엑셀에 NFC 태그 시각·직원 입력 시각·분 차이가 함께 표시되는지 확인.
- 출퇴근 수정 감사 로그, 시급 변경 경계, 주휴 미확인 경고, 엑셀 재계산 확인.
- 반복 일정/예외 일정, 연장근무 시작·종료 자동 구간, 야간·휴일 중첩, 수당 포함 체크 전환을 확인.
- 실제 운영 전 `store_admin`이 사업장 적용 기준·시행일·가산율을 확인하지 않으면 급여 확정을 막는지 확인.

## 예상 변경 파일 요약

- DB: `supabase/migrations/092_nfc_attendance_payroll.sql`, `supabase/tests/092_nfc_attendance_payroll_contract.sql`
- 권한/타입: `src/types/domain.ts`, `src/types/supabase.ts`, `src/lib/staffPermissions.ts`
- 전역 흐름: `src/App.tsx`, `src/lib/attendanceLink.ts`, `src/components/AttendancePunchPrompt.tsx`
- UI: `src/pages/AttendanceManagementPage.tsx`, `src/components/TopMenu.tsx`, `src/routes/lazyPages.ts`
- 계산/내보내기: `src/lib/attendancePayroll.ts`, `src/lib/attendanceExport.ts`
- Native/App Links: `ios/App/App/AppRelease.entitlements`, `android/app/src/main/AndroidManifest.xml`, `public/.well-known/*`
- 테스트: `tests/attendance-*.test.mjs`

## 위험과 제한

- **정적 NFC 스티커는 복제 가능:** 매장 내부용 1차 운영에서는 이 위험을 수용한다. 긴 랜덤 토큰·해시 저장·재발급까지만 적용하고, 실제 문제가 생길 때 위치 확인 또는 회전형 QR/온라인 단말을 추가한다.
- **iOS 완전 자동 처리 제한:** 백그라운드 NFC는 기기/잠금 상태에 따라 시스템 알림을 탭해야 할 수 있다. Task 1 실기기 gate를 통과하기 전 “태그만 하면 항상 자동”을 확정하지 않는다.
- **주휴수당 법적 정확성:** 등록 일정과 출퇴근 기록만으로도 휴가·정당한 결근 등 모든 사유를 판정할 수 없다. 자동 후보를 만들되 관리자 확인 없이 확정하지 않는다.
- **연장근무 자동 검출의 한계:** 늦은 퇴근 태그가 실제 업무인지 단순 퇴근 누락인지 시스템만으로 단정할 수 없다. 시간대는 자동 표시하되 관리자/매니저 확정을 급여 반영 조건으로 둔다.
- **직원 입력 시각과 실제 근무 차이:** 직원이 선택한 급여 반영 시각이 실제 근로 제공 시각과 다를 수 있다. NFC 태그 시각을 삭제·수정하지 않고 차이를 관리자가 항상 볼 수 있게 하며, 급여 확정 책임은 관리자 검토에 둔다.
- **법령 적용 차이:** 사업장 규모·계약·휴일 지정·법 개정에 따라 가산수당 적용이 달라질 수 있다. 적용 기준을 시행일 이력으로 저장하고 생산 사용 전 노무 확인 없이 활성화하지 않는다.
- **시간대:** 매장 기준 시간대를 `Asia/Seoul`로 시작하되 DB에는 UTC로 저장한다. 해외 매장이 생길 때 매장별 timezone 설정을 추가한다.
- **개인정보/급여:** 보존 기간·삭제 정책·엑셀 파일 취급 안내가 필요하다. 급여 데이터는 클라이언트 숨김만으로 보호하지 않는다.

## 확정된 운영 기본값과 구현 게이트

- 매니저는 새 역할이 아니라 기존 `staff + attendance_management` 권한으로 처리한다.
- 매니저는 근태·급여 조회, 일정 관리, 자동 수당 후보 확정이 가능하다. 시급·소정근로시간·법령 적용 기준 수정은 `store_admin`만 가능하다.
- 무급휴게는 등록된 일정의 휴게 구간을 기본값으로 사용하고, 실제와 다르면 근무 건별로 수정한다. 임의의 `4시간/8시간 자동 공제`는 넣지 않는다.
- 급여 조회는 임의 기간을 기본으로 제공한다. 고정 마감일 기능은 실제 필요가 확인될 때 추가한다.
- 생산 활성화 전 관리자가 사업장 규모/적용 기준과 시행일을 확인해야 한다. 확인 전에는 시간·수당을 미리 계산해 보여주되 `예상` 표시를 유지하고 급여 확정을 막는다.
- 실제 App Link 도메인, Apple Team ID, Android 직원 배포 서명 fingerprint는 Task 1 시작 전에 확인한다.

## Ponytail 범위 결정

- 새 `manager` 역할, 완전한 교대 스케줄러, 휴가/결근 승인, 자동 세금·4대보험, 위치추적, 별도 백엔드, 새 엑셀 라이브러리는 추가하지 않는다. 수당 자동 검출에 필요한 주간 반복 일정+날짜별 예외만 만든다.
- 기존 권한·서비스·라우팅·`xlsx`를 재사용한다.
- 물리 NFC 쓰기는 범용 앱으로 시작한다. 매장 설치 과정에서 반복 문제가 확인될 때만 네이티브 NDEF 쓰기 플러그인을 추가한다.
