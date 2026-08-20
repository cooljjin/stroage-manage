# Stockly 보안 강화 작업 중단·재개 계획

기준일: 2026-08-20

상태: 사용자 요청에 따라 추가 구현 중단

작업 브랜치: `codex/security-hardening`

작업 디렉터리: `/Users/jinkim/Documents/storage-manage-security-hardening`

기준 커밋: `b3b6043`

## 1. 현재 상태와 안전 경계

- 기존 변경이 있던 원래 작업공간 `/Users/jinkim/Documents/storage manage`는 수정하지 않고 별도 worktree에서 작업했다.
- 현재 보안 강화 변경은 아직 커밋하지 않은 로컬 변경으로 보존되어 있다.
- Supabase migration/Edge Function 배포, Vercel 배포, GitHub 설정 변경, TestFlight/Android 배포는 하지 않았다.
- 운영 DB 데이터, 운영 상품, 실제 직원 계정, 기존 병합 이력은 변경하지 않았다.
- `supabase db push --dry-run --include-all`만 실행했으며 실제 push는 하지 않았다.
- 이 브랜치는 여러 계층이 함께 바뀌는 중간 상태다. 아래 미완료 항목을 끝내기 전에는 `main`에 병합하거나 배포하지 않는다.

## 2. 지금까지 작성한 구현 초안

아래 항목은 소스에 작성되었지만, DB와 실제 기기까지 검증된 완료 상태는 아니다.

### DB 보안과 가역 상품 병합

- `068_recipe_import_ascii_storage_path.sql`
  - 원격에는 이미 적용된 것으로 dry-run에서 인식되는 migration을 worktree에 포함했다.
  - 재개 시 운영 적용본과 로컬 파일의 정확한 내용·해시를 다시 확인해야 한다.
- `070_security_emergency_containment.sql`
  - 구형 상품 병합·등록 병합·재고 복원 RPC에 로그인, 동일 매장, 활성 상품과 잠금 검사를 추가하는 호환 wrapper 초안.
  - 사용자 UUID 기반 역할/매장 helper를 본인 또는 master 범위로 제한하는 초안.
  - 매장별 휴무 계산과 휴무 변경 트리거 보정 초안.
  - 기존 public schema 함수의 `PUBLIC/anon` 실행 권한을 제거하고 고정 `search_path`를 설정하는 초안.
- `071_reversible_product_aliases.sql`
  - `product_alias_links`와 대표/원본 관계, 병합·해제 스냅샷, 실행자, request ID 보존 구조.
  - 대표 상품 해석, 바코드 조회, 원본 이름 포함 검색, 병합 이력 조회 RPC.
  - 버전 검사·행 잠금·중복 요청 방지·열린 모바일 세션/중복 레시피/바코드 충돌 차단을 포함한 병합·해제 RPC.
  - 활성 원본 상품의 직접 수정·재활성화·재고·바코드 변경을 막는 trigger.
  - 구형 2인자 `merge_products`를 가역 병합으로 연결하는 호환 wrapper.
- `072_safe_write_and_profile_apis.sql`
  - 안전한 재고 행 생성과 상품 생성·복구 RPC.
  - 등록과 병합을 한 요청으로 처리하는 가역 RPC.
  - 재고 메모 생성·수정 RPC.
  - 본인 프로필, 일반 직원 디렉터리, 관리자 디렉터리 RPC와 프로필 RLS 축소.
  - 기존 상품 ID를 대표 상품 ID로 해석하는 참조 조회 RPC.
- `073_recipe_import_limits_and_retention.sql`
  - 주간 사용량, 추가 이용 요청/승인, 건별 고비용 승인, 정리 작업 감사 테이블 초안.
  - 사용자당 1건·매장당 2건 동시 처리, 주 10회+추가 20회, 일반 `$0.50`, master 승인 절대 상한 `$5` 검사 RPC.
  - Gemini 호출 직전 1회만 기록하는 멱등 사용량 RPC.
  - `pg_cron`, `pg_net` extension 활성화 선언.

### 고객용 앱

- `src/lib/resolvedProducts.ts`에 대표 상품 기준 바코드·검색·재고 목록 공통 helper를 추가했다.
- 스캔, 재고 목록, 부족 재고, 상품 검색, 프랩·단체주문 선택 화면을 대표 상품 해석 API 쪽으로 전환하는 초안을 작성했다.
- 상품 편집 화면에 가역 병합 전후 수량 확인, 원본 목록, legacy 해제 불가 표시, 위치별 재분배 해제 UI를 추가했다.
- 재고 메모 직접 insert/update와 일부 재고 직접 upsert를 RPC 호출로 교체했다.
- 홈·로그·직원 관리 화면의 프로필 조회를 범위별 RPC로 교체했다.
- Supabase Auth를 PKCE로 설정하고 네이티브 callback을 scheme=`com.jinkim.stockly`, host=`auth`, path=`/callback`으로 정확히 비교하도록 변경했다.
- URL의 access/refresh token을 직접 `setSession`하던 경로를 제거하고 code와 저장된 state를 검증한 뒤 교환하도록 변경했다.

### Edge Function과 네이티브 설정

- `recipe-import`
  - 사용자 인증을 먼저 확인하고 원자적 processing claim과 Gemini 시작 기록 RPC를 사용하도록 변경했다.
  - Storage 실제 크기, MIME과 파일 시그니처를 확인하도록 변경했다.
  - 사용자용 함수에서 scheduler 정리 분기를 제거했다.
- `recipe-import-cleanup`
  - 전용 secret, 기본 dry-run, 7일 만료 원본 삭제, 90일 감사 로그 정리 함수 초안.
- `account-purge-scheduler`
  - 전용 secret, 기본 dry-run, 만료/개인 매장/현재 구성원 재검사, 매장별 실패 격리와 멱등 재시도 함수 초안.
- `manage-account-deletion`
  - 사용자 탈퇴·복구만 유지하고 scheduler purge를 별도 함수로 분리했다.
- Android 백업을 비활성화하고 FileProvider 경로를 앱 전용 이미지/캐시 경로로 축소했다.

### 운영용 문서·스크립트

- `supabase/sql/configure_retention_cron.sql`
  - Vault 값만 참조해 03:10/03:30 KST에 두 정리 함수를 dry-run으로 호출하는 수동 실행 스크립트.
- `supabase/sql/post_native_security_lockdown.sql`
  - 새 웹·iOS·Android 실제 기기 확인 후에만 직접 테이블 쓰기와 구형 RPC 권한을 회수하기 위한 수동 실행 스크립트.
  - migration에 넣지 않았으며 실행하지 않았다.
- `docs/security-hardening-deployment.md`
  - migration, Edge Function, 웹/네이티브, 최종 권한 회수와 Cron 활성화의 단계별 게이트.
- `docs/privacy-policy-ko.md`
  - Gemini 전송, 7일 원본 보관, 30일 탈퇴 복구, 삭제 실패 재시도 기준을 담은 정책 초안.

## 3. 중단 시점 안정화 결과

- 중단 직후 발견한 `InventoryListPage.tsx` 괄호 누락을 수정했다.
- 사용하지 않는 import 2개를 제거했다.
- `npm ci` 성공. 현재 Node `v23.11.0`은 ESLint가 공식 요구하는 범위가 아니어서 engine 경고가 있었지만 설치는 완료됐다.
- `npm run build` 성공.
- `npm run build:admin` 성공.
- `npm run lint` 성공.
- `npx eslint src admin-console/src` 성공.
- `git diff --check` 성공.
- `npx supabase db push --dry-run --include-all` 성공. 실제 반영 없이 `070~073`만 적용 예정으로 표시됐다.

위 결과는 TypeScript/번들/ESLint와 migration 목록 연결만 확인한다. SQL 실행 성공, RLS 보안, Edge Function 동작, 브라우저, OAuth, 네이티브 실제 기기 동작을 증명하지 않는다.

## 4. 현재 미완료 또는 위험한 부분

### 반드시 먼저 해결할 항목

1. Docker가 실행되지 않아 깨끗한 로컬 Supabase에 `001~073` 전체 migration을 실제 적용하지 못했다.
2. `070~073` SQL은 원격에도 로컬 DB에도 실행하지 않았으므로 문법, 함수 시그니처, trigger와 권한 상호작용을 아직 검증하지 못했다.
3. 가역 병합 중 기존 프랩/레시피 참조를 대표 재고로 처리하는 서버 쓰기 경로를 끝까지 감사하지 못했다. 특히 `record_prep_operation`과 레시피 적용 RPC를 재확인해야 한다.
4. 고객용 `RecipeImportPage`는 새 `$0.50`/master 승인 흐름에 맞게 완성되지 않았다. 현재 초안 그대로 배포하면 `$0.50` 초과 작업의 사용자 흐름이 막힐 수 있다.
5. admin console의 추가 횟수 요청 승인·주간 부여·건별 비용 승인 화면은 아직 만들지 않았다.
6. Edge Function은 Deno type check와 로컬 serve/invoke 검증을 하지 않았다. 특히 계정 purge의 부분 실패·재시도 동작을 테스트 DB에서 확인해야 한다.
7. `post_native_security_lockdown.sql`은 의도적으로 미실행 상태다. 구버전 네이티브 앱이 남은 동안 실행하면 재고/메모/발주 기능이 중단될 수 있다.

### 아직 시작하지 않았거나 끝내지 못한 항목

- `profiles`, `inventory`, `inventory_logs`, `product_barcodes`, `confirmed_order_items` 직접 호출 잔여 전체 감사.
- 가역 병합용 트랜잭션/동시성/다중 원본/원본별 해제 pgTAP 또는 SQL 회귀 테스트.
- 기존 58건 legacy 이력의 정확한 건수와 불변성 운영 조회. 운영 데이터는 수정하지 않는다.
- 과거 휴무 trigger 영향 분석.
- 일반 직원 이메일 비노출과 관리자/master 허용 범위 역할별 검증.
- Google/Kakao 웹 PKCE와 iOS/Android callback/replay 실제 검증.
- Universal Links/App Links 후속 릴리스.
- 레시피 승인 UI와 quota 표시/추가 이용 요청 UI.
- cleanup/account purge dry-run, 테스트 객체·테스트 계정 삭제와 재시도 검증.
- `.gitignore`의 `tmp/`, archive/provisioning, `supabase/.temp/` 정리.
- 추적 중인 `supabase/.temp/` 메타데이터 제거.
- 공개 문서와 과거 SQL patch에 있는 실제 테스트 이메일/UUID의 placeholder 교체.
- Vercel CSP/HSTS 등 보안 헤더.
- Dependabot/CodeQL 파일과 GitHub private/secret scanning/push protection/branch protection 설정.
- `npm audit`의 high 3건 원인 분석과 안전한 patch 업데이트. 자동 `npm audit fix`는 실행하지 않았다.
- iOS/Android 빌드와 Capacitor copy.
- 개인정보 처리 안내의 사업자 정보, 문의처, 시행일, Google 처리 조건 법무 확인.

## 5. 재개 계획

### 단계 A — 현재 초안 보존과 DB 실행 가능성 확인

1. 이 worktree의 `git status --short --branch`와 사용자 변경을 다시 확인한다.
2. Docker를 시작한 뒤 깨끗한 로컬 Supabase에서 전체 migration을 적용한다.
3. `068`을 운영 적용본과 대조하고 차이가 있으면 `068`을 임의 수정하지 말고 원인을 먼저 확인한다.
4. SQL 오류가 있으면 아직 미적용인 `070~073` 안에서 수정할 수 있지만, 운영 적용 뒤에는 반드시 새 corrective migration을 사용한다.
5. DB lint와 아래 권한 감사를 통과시킨다.
   - 익명 실행 가능한 `SECURITY DEFINER` 함수 0개
   - mutable `search_path` 경고 0개
   - authenticated 함수는 문서화한 allowlist와 일치

### 단계 B — 가역 병합 서버 계약 완성

1. 두 테스트 매장과 `테스트` 상품만으로 병합/해제 SQL 회귀 테스트를 작성한다.
2. 같은 요청 재전송, 동시 병합, 오래된 위치별 버전, 열린 모바일 세션, 바코드 충돌을 검증한다.
3. 다중 원본, 중첩/순환 거부와 원본 하나씩 해제를 검증한다.
4. 병합·해제 전후 창고/매장 총재고 불변을 검증한다.
5. 프랩, 단체주문 레시피와 기타 기존 상품 참조를 서버에서 대표 재고로 해석하도록 누락된 RPC를 보정한다.
6. 과거 로그 ID와 레시피 참조 ID가 바뀌지 않는지 확인한다.

### 단계 C — 클라이언트와 관리자 UI 완성

1. 모든 상품 선택/검색/스캔 경로가 공통 대표 상품 API를 사용하는지 검색한다.
2. 직접 테이블 쓰기/프로필 읽기 잔여를 제거하고 대응 RPC 계약을 타입에 반영한다.
3. 레시피 페이지에 이번 주 사용량, 남은 횟수, 추가 이용 요청과 master 승인 대기 상태를 구현한다.
4. admin console에 요청 승인, 주간 추가 부여, `$0.50~$5` 건별 승인 화면을 구현한다.
5. 병합·해제 상세 비교, legacy 해제 불가, 오류 메시지를 브라우저에서 확인한다.

### 단계 D — Edge Function·보관 작업 검증

1. Edge Function Deno type check와 로컬 serve 테스트를 수행한다.
2. 크기/MIME/시그니처 위조, 동일 작업 이중 호출, 주간 한도와 동시 처리 제한을 검증한다.
3. 서로 다른 cleanup/purge secret을 생성하되 Git/로그/클라이언트에는 기록하지 않는다.
4. Cron은 dry-run으로만 시작하고 대상 수를 테스트 데이터와 대조한다.
5. 테스트 Storage 객체와 테스트 개인 매장의 실제 삭제·재시도 후에만 `dryRun=false`로 전환한다.

### 단계 E — 저장소·웹 보강

1. 추적 중인 임시 메타데이터와 공개 문서 식별자를 정리한다.
2. Vercel Preview에 CSP, HSTS, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`, `frame-ancestors`를 적용해 OAuth/PWA/Storage 영향을 확인한다.
3. npm audit high 항목을 직접 분석하고 호환되는 patch/minor 범위에서 업데이트한다.
4. Dependabot, CodeQL 설정 파일을 추가한다.
5. GitHub private 전환, 협업자/연결/secret/branch protection 변경은 사용자의 별도 승인 후 콘솔에서 수행한다.

### 단계 F — 단계적 출시

1. migration과 schema cache를 먼저 적용·확인한다.
2. Edge Function을 배포하고 dry-run만 등록한다.
3. 웹 Preview와 production 순으로 확인한다.
4. 새 iOS/Android 빌드를 설치해 실제 기기에서 PKCE, 스캔, 검색, 병합, 메모와 발주를 검증한다.
5. 설치된 구버전 앱 영향이 없음을 확인한 뒤 `post_native_security_lockdown.sql`을 별도 승인받아 실행한다.
6. 마지막으로 정리 Cron 실제 삭제를 별도 승인받아 활성화한다.

## 6. 재개 시 기본 검증 명령

```bash
cd "/Users/jinkim/Documents/storage-manage-security-hardening"
git status --short --branch
npm ci
npm run build
npm run build:admin
npm run lint
npx eslint src admin-console/src
git diff --check
npx supabase status
npx supabase db reset
npx supabase db lint --local
```

원격 이력 비교와 dry-run은 읽기 검증으로만 수행한다. 실제 `db push`, Edge Function 배포, Vercel 배포, GitHub 설정 변경, native Archive/Upload는 사용자 승인 전 실행하지 않는다.

## 7. 변경 파일 빠른 위치

- DB: `supabase/migrations/070_security_emergency_containment.sql` ~ `073_recipe_import_limits_and_retention.sql`
- 수동 운영 SQL: `supabase/sql/configure_retention_cron.sql`, `supabase/sql/post_native_security_lockdown.sql`
- 대표 상품 공통 로직: `src/lib/resolvedProducts.ts`
- 병합/해제 UI: `src/pages/ProductEditPage.tsx`
- 스캔/검색/목록: `src/pages/ScanPage.tsx`, `InventoryListPage.tsx`, `LowStockPage.tsx`
- PKCE: `src/lib/supabase.ts`, `src/services/auth/AuthService.ts`, `src/App.tsx`
- Edge Functions: `supabase/functions/recipe-import*`, `account-purge-scheduler`, `manage-account-deletion`
- 운영 배포 게이트: `docs/security-hardening-deployment.md`

이 문서를 기준으로 재개하되, “소스에 있음”, “로컬 검증됨”, “원격 적용됨”, “실제 기기 검증됨”을 서로 다른 상태로 보고한다.
