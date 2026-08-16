# Stockly 다중 매장 구현 기준

마지막 점검: 2026-08-13 로컬 소스

이 문서는 초기 이메일 초대 구현 기록이 아니라 현재 다중 매장 구조의 유지보수 기준이다. 운영 DB 적용 상태는 `npx supabase migration list --linked`로 별도 확인한다.

## 역할

- `master`: 별도 운영 콘솔에서 전체 매장·사용자 관리
- `store_admin`: 본인 매장 설정과 직원 관리
- `staff`: 본인 매장의 재고 업무 수행

일반 직원은 `staff_permissions`를 통해 카테고리, 발주처, 메뉴 레시피, 발주 품목 확정 권한을 선택적으로 받을 수 있다.

## 매장 연결 방식

신규 로그인 계정에 `profiles` 행이 없으면 고객용 앱에서 다음 중 하나를 선택한다.

### 새 매장 만들기

```sql
create_personal_store(store_name text)
```

- 매장을 만든 사용자가 `store_admin`이 된다.
- 개인 매장 탈퇴에는 30일 복구 기간이 적용될 수 있다.

### 초대코드로 참여

관리자는 역할을 선택해 코드를 만든다.

```sql
create_store_invite(target_role profile_role)
```

참여자는 로그인 후 코드를 입력한다.

```sql
accept_store_invite_code(invite_code text)
```

현재 초대는 이메일 주소를 요구하지 않는다. 이미 매장에 소속된 계정은 다른 코드를 수락할 수 없고, 일반 직원은 초대코드를 만들 수 없다.

공유 URL:

```text
https://<app-origin>/?inviteCode=ABCD2345
```

고객용 앱은 `inviteCode`, `invite_code`, `code` 쿼리를 읽고 로그인 전에는 localStorage에 임시 보관한다.

## 데이터 범위

매장별 데이터 테이블은 `store_id`를 가져야 한다. 주요 범위:

- `profiles`
- `products`, `product_barcodes`, `inventory`, `inventory_logs`
- `categories`, `product_units`, `suppliers`
- `confirmed_order_items`
- `dashboard_todos`, `todo_routines`, `handover_notes`
- 프랩과 단체주문 관련 테이블
- 매장 설정과 휴무일

프런트엔드 쿼리도 가능한 한 `.eq("store_id", currentStoreId)`를 명시한다. 최종 보호선은 RLS와 RPC 내부 검증이다.

## 권한 보호

- 메뉴와 route guard는 사용자 경험을 위한 1차 제한이다.
- 실제 읽기·쓰기 권한은 Supabase RLS가 강제해야 한다.
- `security definer` RPC는 `auth.uid()`, 요청자 역할, 대상 `store_id`를 함수 안에서 재검증해야 한다.
- Edge Function의 service-role 사용은 요청자의 JWT와 역할을 먼저 검증한 뒤 최소 범위로 제한한다.

## master 운영 콘솔

`master` 계정은 고객용 앱 기능을 사용할 수 없고 `admin-console/`을 사용한다.

현재 기능:

- 전체 매장 조회·생성
- 전체 사용자 조회
- 이름·배정 매장 수정
- 사용자 삭제
- 초대코드와 공유 URL 생성

남은 제한:

- 매장 이름·상태 수정 없음
- 사용자 역할 변경 없음
- 초대 대상 매장 선택 없음

특히 운영 콘솔의 초대 RPC가 어느 `store_id`를 사용하는지 실제 master 프로필과 함께 확인한 뒤 운영에 사용한다.

## 계정 탈퇴

- 일반 직원: 본인 계정만 영구 삭제
- 공동 매장의 관리자: 같은 매장의 일반 직원을 새 관리자로 이관한 뒤 본인 계정 삭제
- 구성원이 없는 개인 매장 관리자: 30일 동안 `pending_deletion`, 기간 내 복구 가능
- master: 고객용 탈퇴 화면에서 처리하지 않음

계정 탈퇴 로직은 `manage-account-deletion` Edge Function이 담당한다. 로컬 코드 변경과 실제 함수 배포 상태를 분리해서 확인한다.

## 2026-08-13 진행 중 변경

`059_security_data_protection.sql`은 `product_units`를 매장별로 분리하고 관련 RLS와 `rename_product_unit` RPC를 추가한다. 파일이 존재하는 것만으로 원격 적용이 완료된 것은 아니다.

적용 전 확인:

1. 기존 단위 행이 어느 매장으로 배정되는지 확인
2. 모든 매장에 기본 단위가 존재하는지 확인
3. 상품의 기존 `unit_name` 연결 보존 확인
4. 매장 간 단위 조회·수정 차단 확인
5. 앱 타입과 쿼리의 `store_id` 일치 확인

## 검증 체크리스트

- 새 계정으로 개인 매장 생성
- 관리자 코드로 `staff` 참여
- 관리자 코드로 `store_admin` 참여
- 이미 소속된 계정의 다른 코드 수락 차단
- 직원의 초대코드 생성 차단
- 두 매장 간 상품·재고·로그·기준정보 격리
- 직원별 추가 권한의 UI와 RLS 일치
- master 고객용 앱 차단과 운영 콘솔 접근
- 일반 직원, 공동 매장 관리자, 개인 매장 관리자 탈퇴 분기
