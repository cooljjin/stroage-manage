# `manage-account-deletion` Edge Function

마지막 소스 점검: 2026-08-13

이 함수는 계정 역할과 매장 형태에 따라 탈퇴 가능 여부, 탈퇴 요청, 개인 매장 복구를 처리한다. 만료 계정 영구 정리는 별도 `account-purge-scheduler` 함수가 담당한다.

## 요청 종류

로그인 사용자의 JWT가 필요한 요청:

- `{"action":"eligibility"}`: 탈퇴 분기와 이관 가능 직원 확인
- `{"action":"request"}`: 탈퇴 실행
- `{"action":"request","transferToUserId":"<user-id>"}`: 공동 매장 관리자의 관리자 이관 후 탈퇴
- `{"action":"restore"}`: 30일 안의 매장 탈퇴 요청 복구
- `{"action":"delete_now"}`: 탈퇴 요청 중인 단독 매장과 auth 계정을 즉시 영구 삭제

## 역할별 동작

- `staff`: 본인 auth 계정만 영구 삭제하며 다른 직원을 관리자로 승격하지 않음
- 공동 매장의 `store_admin`: 같은 매장의 `staff`를 새 관리자로 이관한 뒤 본인 계정 삭제
- 이관할 구성원이 없는 단독 `store_admin`: 매장 이관 없이 30일 복구 기간으로 탈퇴 요청 가능
- 탈퇴 요청 중인 단독 `store_admin`: 복구 대신 매장 데이터와 auth 계정을 바로 영구 삭제 가능
- `master`: 고객용 탈퇴 endpoint에서 거부

관리자 이관 뒤 본인 auth 삭제가 실패하면 새 관리자의 역할을 다시 `staff`로 되돌리려고 시도한다.

## 필요한 환경변수

Supabase가 기본 제공하는 값:

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`

service-role key는 클라이언트 코드, Git, 로그에 넣지 않는다.

## 배포 전제

- migration `043_account_deletion_recovery.sql`의 계정 탈퇴·복구 컬럼이 적용되어야 한다.
- 현재 역할 검증 변경은 Edge Function을 다시 배포해야 운영에 반영된다.
- 배포와 scheduler 등록은 사용자의 명시적 지시 후 수행한다.

## 검증 체크리스트

- 일반 직원 eligibility가 `kind: "staff"`를 반환하는지
- 일반 직원 요청에 `transferToUserId`가 있으면 거부하는지
- 일반 직원 탈퇴가 다른 프로필과 매장 데이터에 영향을 주지 않는지
- 공동 매장 관리자가 같은 매장의 일반 직원에게만 이관할 수 있는지
- 이관 대상이 관리자 또는 다른 매장 사용자면 거부하는지
- 개인 매장 요청 후 로그인 시 복구 화면이 표시되는지
- 30일 안 복구 시 매장·프로필 상태가 정상화되는지
- `purge` action이 더 이상 이 사용자용 함수에서 실행되지 않는지

운영 계정으로 직접 검증하지 말고 허용된 테스트 매장과 테스트 계정을 사용한다.
