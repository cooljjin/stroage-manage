# Stockly 보안 강화 현재 상태와 다음 진행 계획

기준일: 2026-08-20

상태: 로컬 구현·회귀 검증 완료, 운영/Preview/실기기 미적용

작업 브랜치: `codex/security-hardening`

작업 디렉터리: `/Users/jinkim/Documents/storage-manage-security-hardening`

기준 커밋: `b3b6043`

로컬 중간 체크포인트: `29dafde` (`WIP: checkpoint security hardening draft`)

최종 로컬 구현 커밋: `Complete local security hardening implementation` (이 문서를 포함한 현재 브랜치 `HEAD`)

## 1. 안전 경계

- 기존 변경이 있던 `/Users/jinkim/Documents/storage manage`와 `main`은 수정하지 않았다.
- 보안 변경은 별도 worktree/브랜치에만 있으며 원격으로 push하지 않았다.
- 운영 Supabase migration/Edge Function, Vercel, GitHub 설정, App Store Connect/TestFlight, Android 배포는 변경하지 않았다.
- 운영 상품, 실제 직원, 기존 병합 이력과 휴무 데이터는 수정하지 않았다.
- 로컬 검증은 격리된 Supabase와 `example.invalid`, 고정 테스트 UUID, 이름에 `테스트`가 포함된 fixture만 사용했다. 마지막에 `supabase db reset`을 다시 실행해 fixture를 남기지 않았다.
- `post_native_security_lockdown.sql`은 로컬에서만 적용·검증한 뒤 DB reset으로 되돌렸다. 운영에는 적용하지 않았다.

## 2. 구현된 범위

### DB 보안과 가역 상품 병합

- `070_security_emergency_containment.sql`
  - 구형 병합·복원 RPC의 로그인, 동일 매장, 활성 상품, 행 잠금 검사
  - 본인/master 범위 역할 helper
  - 매장별 휴무 계산과 변경 매장만 이동하는 trigger
  - 모든 public 함수의 `PUBLIC/anon` 실행 제거와 고정 `search_path`
- `071_reversible_product_aliases.sql`
  - 대표 상품과 보존 원본을 연결하는 `product_alias_links`
  - 위치별 버전, 행 잠금, `request_id`, 열린 모바일 세션, 레시피 중복, 바코드 충돌 검사
  - 원본 이름·기본/보조 바코드 검색 및 스캔의 대표 상품 해석
  - 위치별 수량 재배분을 받는 원본별 병합 해제와 감사 로그
  - 활성 원본의 직접 상품/재고/바코드 변경 차단 trigger
  - 기존 `product_merge_history`는 legacy·해제 불가로 조회
- `072_safe_write_and_profile_apis.sql`
  - 상품·최초 재고 행·메모 쓰기 RPC
  - 본인/직원 디렉터리/관리자 프로필 조회 분리
  - 상품 참조의 대표 ID 해석 RPC
- `073_recipe_import_limits_and_retention.sql`
  - 주 10회, 추가 최대 20회, 사용자 1건·매장 2건 동시 처리
  - 일반 `$0.50`, master 승인 절대 상한 `$5`
  - 실제 Gemini 시작 직전 1회만 과금하는 멱등 기록
  - 별도 보관 작업 감사와 `pg_cron`/`pg_net`
- `074_alias_aware_inventory_operations.sql`
  - 기존 프랩/단체주문 참조 ID는 유지하면서 실행 시 대표 재고로 해석
  - 새 프랩·단체주문·레시피 별칭 연결은 대표 ID로 저장
  - 재고 작업·입고 확인·실사·프랩 RPC의 대표 상품 처리
- `075_recipe_import_approval_workflow.sql`
  - 업로드 manifest 보존, 사용자 저비용 승인, master 고비용 승인
  - 이미 완료된 고비용 결과 승인 시 Gemini 재실행 방지
  - 추가 이용 요청 반려 API
- `076_profile_write_apis.sql`
  - Auth 이메일을 서버에서 동기화
  - 같은 매장 관리자 이름 수정과 master 사용자 배정 RPC
- `077_edge_service_role_privileges.sql`
  - Edge Function이 직접 사용하는 테이블에만 service-role 최소 권한 부여
- `078_account_purge_retry_safety.sql`
  - Auth 삭제를 막는 매장 범위 `RESTRICT` 참조를 선삭제할 최소 권한
  - 계정은 삭제됐지만 매장 삭제가 실패한 부분 완료 상태의 재시도 지원

### 고객 앱과 운영 콘솔

- 스캔, 상품 검색, 재고/부족재고, 프랩·단체주문 선택을 대표 상품 해석 API로 전환했다.
- 과거 원본 ID로 재고 작업 화면에 진입해도 대표 상품을 먼저 해석한다.
- 상품 편집 화면에 병합 전후 비교, 활성 원본, legacy 해제 불가, 위치별 병합 해제 UI를 추가했다.
- 보호 대상인 `inventory`, `inventory_logs`, `confirmed_order_items`, `product_barcodes`, `profiles`의 직접 클라이언트 쓰기를 제거했다.
- 프로필 조회·수정을 대상별 RPC로 분리했다.
- 레시피 가져오기 화면에 주간 quota, 추가 이용 요청, 고비용 승인 대기와 재처리 방지를 반영했다.
- admin console에 추가 횟수 승인/반려, 수동 주간 부여, 건별 비용 승인 화면을 추가했다.
- 최종 `authenticated` RPC 80개와 전환기 구형 예외 3개를 `security-authenticated-rpc-allowlist.md`에 고정했다.

### 인증·네이티브·보관 작업

- Supabase 클라이언트를 PKCE로 전환했다.
- 네이티브 callback은 `com.jinkim.stockly://auth/callback`의 scheme/host/path를 정확히 확인한다.
- 저장된 단기 state와 `code`만 교환하고 URL token을 직접 `setSession`하던 경로를 제거했다.
- Android 백업을 비활성화하고 FileProvider를 앱 전용 `images/`와 캐시 경로로 축소했다.
- 사용자 처리와 scheduler 처리 Edge Function을 분리했다.
- 레시피 원본과 계정 purge는 서로 다른 secret을 사용하고, 기본 scheduler 예시는 dry-run만 등록한다.
- 레시피 파일은 Storage에서 다시 읽어 실제 크기, MIME, PDF/XLS/XLSX 시그니처와 CSV UTF-8을 검사한다.

### 저장소·웹

- `tmp/`, Supabase 임시 메타데이터, archive/IPA/provisioning/DerivedData를 Git ignore에 추가했다.
- 추적 중이던 `supabase/.temp/` 파일을 Git 인덱스에서 제거했다.
- 공개 문서/과거 SQL의 테스트 이메일·UUID를 placeholder로 바꿨다.
- CSP, HSTS, nosniff, Referrer/Permissions Policy, `frame-ancestors`와 X-Frame-Options를 `vercel.json`에 추가했다.
- Dependabot, CI, CodeQL workflow를 추가했다.
- `brace-expansion`, `fast-uri`, `nanoid`의 취약 전이 버전을 호환 patch로 갱신했다.

## 3. 로컬 검증 결과

### DB와 권한

- 깨끗한 로컬 Supabase에서 `001~078` 전체 migration 적용 성공
- `supabase db lint --local --level warning`: 오류 0
- 익명 실행 가능한 `SECURITY DEFINER`: 0
- `PUBLIC` 실행 가능한 `SECURITY DEFINER`: 0
- 고정 `search_path`가 없는 `SECURITY DEFINER`: 0
- 최종 직접 권한 회수 스크립트와 별도 계약 테스트 성공 후 DB reset 완료

통과한 SQL 회귀 테스트:

- `060_mobile_inventory_sessions_contract.sql`
- `074_reversible_alias_contract.sql`
- `074_reversible_alias_guards_contract.sql`
- `075_recipe_import_limits_contract.sql`
- `076_profile_scope_contract.sql`
- `077_edge_service_role_contract.sql`
- `078_account_purge_dependencies_contract.sql`
- `post_native_security_lockdown_contract.sql`은 최종 gate를 로컬 적용한 상태에서 별도 통과

검증된 병합 조건:

- 타 매장 거부, 중복 요청 멱등, 오래된 위치 버전 거부
- 열린 모바일 세션과 바코드 충돌 거부
- 다중 원본 병합, 대표의 중첩 원본화 거부, 원본별 해제
- 음수/잘못된 위치 합계/오래된 버전 해제 거부
- 병합·해제 전후 창고/매장 총재고 보존
- 원본 이름·기본/보조 바코드가 대표 하나로 해석
- 과거 프랩/단체주문 참조 ID 유지, 병합 중 대표 재고 차감
- 병합 중 새 연결은 대표 ID 유지, 해제 시 다른 원본 영향 없음

### Recipe Import와 보관 작업

- Edge Function 6개 로컬 기동 성공
- 무인증 사용자 함수와 잘못된 cleanup/purge secret: 401
- 위조 XLSX 시그니처, 실제 크기 불일치, 잘못된 CSV MIME: 모두 Gemini 호출 전에 거부
- 위 세 작업의 `gemini_started_at`과 과금 기록: 0
- 주 10회, 추가 최대 20회, `$0.50/$5`, 사용자/매장 동시 제한, claim 멱등 테스트 성공
- 레시피 원본: dry-run 후보 1 → 실제 Storage 삭제 1 → 재실행 후보 0, DB path/manifest 비움 확인
- 빈 개인 매장과 상품·재고·열린 모바일 세션이 있는 개인 매장 모두 실제 purge 성공
- Auth 삭제 후 매장만 남은 부분 실패 재시도 성공
- 후보 2건 중 잘못된 소유권 1건 실패 시 정상 1건은 계속 삭제하는 실패 격리 성공
- 감사 행에는 후보/성공/실패 수와 오류 코드만 남고 파일명·token·secret은 기록하지 않음

### 앱·저장소

- `npm ci`: 성공
- `npm audit`: 취약점 0
- `npm audit --omit=dev`: 취약점 0
- `npm run build`: 성공
- `npm run build:admin`: 성공
- `npm run lint`: 성공
- `npx eslint src admin-console/src`: 성공
- `git diff --check`: 성공
- Android Capacitor sync 및 `assembleDebug`: 성공
- iOS Capacitor sync/pod install 및 서명 없는 simulator Debug build: 성공
- 현재 파일과 Git 전체 이력의 대표 secret 패턴 스캔: 후보 파일 0

위 검증은 로컬 소스/DB/시뮬레이터 빌드 증거다. 운영 배포, provider OAuth 성공, 실제 기기 callback, TestFlight/Play 배포를 증명하지 않는다.

## 4. 남은 작업과 배포 차단 조건

### 운영 적용 전에 반드시 확인

1. 운영 migration 이력과 로컬 `068`의 실제 적용본/해시를 대조한다.
2. 운영 데이터는 읽기 전용으로 기존 legacy 병합 건수와 휴무 trigger 과거 영향만 분석한다.
3. `070~078`을 운영에 단계 적용하고 각 단계의 schema cache와 함수 시그니처를 확인한다.
4. 새 RPC가 확인되기 전에는 새 웹/네이티브 클라이언트를 배포하지 않는다.
5. 실제 secret은 서로 다르게 생성해 Edge secrets와 Vault에만 저장한다. 문서·Git·로그에 값을 남기지 않는다.

### Preview와 실제 기기 검증

1. Vercel Preview에서 CSP가 OAuth, PWA, Storage 업로드, 웹 카메라 스캔을 막지 않는지 확인한다.
2. Google/Kakao 웹 PKCE 로그인을 확인한다.
3. iOS/Android 실제 기기에서 정상 callback, 잘못된 scheme/host/path, state 불일치, replay 거부를 확인한다.
4. 실제 기기에서 스캔, 검색, 가역 병합/해제, 메모, 발주, 프랩·단체주문을 테스트 상품으로 확인한다.
5. 새 네이티브 앱 설치 범위를 확인하기 전에는 최종 직접 권한 회수를 실행하지 않는다.

### 외부 콘솔과 법무 확인

- Supabase Auth 유출 비밀번호 보호 활성화
- GitHub private 전환 전 협업자/Vercel/Actions secret 확인
- GitHub secret scanning/push protection, security updates, 필수 CI/CodeQL과 branch protection 활성화
- Vercel Preview 확인 뒤 Production 보안 헤더 적용
- 개인정보 안내의 사업자 정보, 문의처, 시행일과 Google 국외 처리 조건 확정
- PKCE 안정화 후 Universal Links/App Links 후속 릴리스

## 5. 다음 진행 순서

1. 운영/로컬 migration 이력과 `068` 대조 — 읽기 전용
2. 운영 DB 백업/PITR와 rollback 담당 확인
3. `070` 긴급 보정 적용 및 권한/휴무 smoke test
4. `071~078` 적용, schema cache와 RPC allowlist 확인
5. Edge Function 배포와 서로 다른 secret 설정
6. cleanup/purge Cron을 `dryRun=true`로만 등록하고 후보 수 대조
7. 웹 Preview 배포 및 CSP/OAuth/가역 병합/레시피 승인 UI 확인
8. 웹 Production과 새 네이티브 빌드 배포
9. 실제 기기 검증과 구버전 사용 현황 확인
10. 별도 승인 후 `post_native_security_lockdown.sql` 실행
11. 테스트 삭제·재시도 증거 확인 후 별도 승인으로 Cron 실제 삭제 활성화
12. PKCE 안정화 후 Universal/App Links 릴리스

운영 migration, Edge/Vercel 배포, GitHub 설정, TestFlight/Android 배포와 최종 권한 회수는 사용자의 별도 실행 지시 전에는 진행하지 않는다.
