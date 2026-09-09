# Stockly Luna Task List

설계 기준: `2026-09-08_201033-stockly-catalog-architecture.md`.

## 모든 Task에 적용되는 실행 계약

- 작업 디렉터리 `/Users/jinkim/Desktop/stroage-manage`. AGENTS.md/README.md를 먼저 읽는다.
- Orchestrator가 명시적으로 준 **단 하나의 Task**만 실행한다. 의존 작업을 스스로 실행하거나 다음 Phase를 시작하지 않는다.
- 실제 model이 codex-luna로 확인된 프로세스만 사용. 다른 모델로 대체하지 않는다.
- main 기존 사용자 변경 보존. reset/clean/stash, 새 worktree/branch, push/배포/운영 DB 변경 금지.
- 아래 `예정 파일`은 아직 존재하지 않는 제안 경로. migration은 실행 시 최신 번호 뒤에 append-only로 생성한다.
- 파일 수정 전 모든 직접 caller와 저장/복구 경로를 확인. 중대한 계약/권한/아키텍처 문제가 있으면 STOP 후 보고.
- 새 비자명 로직은 runnable test를 남기고 RED→GREEN을 보고. 테스트 framework 추가 없이 기존 Node test/SQL/Deno 사용 우선.
- **공통 검증 V:** `node --test test/*.test.mjs tests/*.test.mjs`, `npm run build`, `npm run lint`, `git diff --check`. 실패는 기존/신규 원인을 분리하며 실패 출력을 숨기지 않는다. build 산출물 커밋 금지.
- **SQL 검증 S:** isolated DB 전체 migration 재생 + 해당 SQL 계약. anon/타 매장/동시성/재시도/rollback 확인. `supabase test db --local` 또는 확인된 psql 연결 사용. 원격 reset 금지. 환경 없으면 미실행으로 보고.
- **Edge 검증 E:** 해당 Deno check/test와 fetch mock, 인증 없음/타매장/입력 제한/timeout/429/malformed. 외부 quota 소모하는 대량 테스트 금지.
- **공통 변경 금지 B:** 기존 재고량·로그·모바일 명시 저장·복원/병합 의미·수동 등록·SMS·기존 URL·OAuth·매장 격리 및 사용자 변경. Task가 명시한 최소 접점 외 변경 금지.
- **공통 결과 보고 R:** 변경 파일, 구현 내용, 정확한 실행 명령과 결과/exit code, 발견 문제, 미해결 문제/미실행 검증, 다음 Task 영향. diff 범위와 migration 이름, model 식별도 포함. '성공 예상'을 실제 성공으로 보고하지 않는다.
- 아래 각 Task의 B/V/S/E/R 참조는 이 공통 요구사항을 그대로 포함한다. 실제 위임 시 Orchestrator는 이 공통 계약과 해당 Task를 함께 전달한다.

## Phase 1 — Product Catalog Foundation

### Luna Task 01 — 기준선 및 DB 실행 환경 확인
- **Depends on:** Phase 0 설계 검토, 실제 Luna 실행 경로 확인.
- **목적:** 기존 실패/원격 drift를 신규 기능 문제와 구분.
- **현재 구조:** main 20058ef 조사, migration 001~082, 별도 post_native_security_lockdown.sql 존재, tests/test 두 디렉터리.
- **변경 대상:** 예정 `docs/stockly-catalog-baseline.md`만. 앱/SQL 코드 수정 없음.
- **구현 요구사항:** git 상태 보존, V 실행; isolated DB 준비 상태와 migration replay 가능 여부 확인. 승인된 메타데이터 접근으로만 remote migration/grants/RLS/RPC 비교. 권한 없으면 미검증 목록 반환.
- **설계 결정:** 운영 row 조회 없음. 타입/로컬 migration을 live 상태로 간주하지 않음.
- **변경 금지 영역:** B, DB 적용/환경 설치/운영 연결 변경.
- **완료 조건:** 기준선 pass/fail 표, 정확한 DB 검증 환경, drift 또는 blocker 목록.
- **검증:** V, 이미 준비된 isolated DB에서만 S.
- **결과 보고:** R. 필요한 승인/도구가 없으면 다음 migration 작업을 보류.

### Luna Task 02 — GTIN 검증·정규화
- **Depends on:** Task 01.
- **목적:** leading zero를 보존하는 강한 lookup key.
- **현재 구조:** ScanPage의 12/13 후보 처리, native는 UPC_E 포함 여러 format 지원.
- **변경 대상:** 예정 `src/lib/gtin.ts`, `tests/gtin.test.mjs`.
- **구현 요구사항:** 8/12/13/14 ASCII digit+check digit 검사, valid 값만 GTIN-14 padding, 원문 보존. invalid/ambiguous 결과 분리; UPC-E를 EAN-8로 처리 금지.
- **설계 결정:** 기존 내부 조회 후보 함수는 바꾸지 않음. UPC-E 자동 expansion은 V1 제외, 수동 입력/종류 확인.
- **변경 금지 영역:** B, scanner/native 설정.
- **완료 조건:** 유효/무효/0-padding 동치/0 아닌 포장 indicator/문자·기호·길이/예시 8801234567890 실패 테스트.
- **검증:** runnable pure utility test + V. TypeScript 실행은 설치된 compiler를 이용하며 새 runner dependency 금지.
- **결과 보고:** R, 공용 결과 타입과 미지원 형식.

### Luna Task 03 — Catalog와 nullable Product 컬럼
- **Depends on:** Task 01, Task 02 계약.
- **목적:** 재고 테이블을 교체하지 않고 식별 정보 연결.
- **현재 구조:** Product/Inventory 별도, Product는 brand/image/catalog 없음.
- **변경 대상:** 새 migration `*_product_catalog.sql`, `src/types/domain.ts`, `src/types/supabase.ts`, 예정 `supabase/tests/product_catalog_contract.sql`.
- **구현 요구사항:** 설계 E의 Catalog 필드/GTIN constraints/RLS 및 products.catalog_id/brand/image_url/catalog_confirmed_at. 외부 출처 metadata 노출은 허용된 값만.
- **설계 결정:** GTIN unique, products FK SET NULL, index, 기존 row nullable; Catalog authenticated read만. 일반 사용자 write 및 PUBLIC execute 권한 없음.
- **변경 금지 영역:** B, 기존 migration 수정/백필/수량 컬럼.
- **완료 조건:** old payload 호환; 새 테이블 무권한 쓰기 거부; foreign key와 check digit DB 검사; 기존 inventory 데이터 불변.
- **검증:** S + V. DB GTIN 결과와 Task 02 fixture 일치.
- **결과 보고:** R, 적용 순서와 schema cache 안내.

### Luna Task 04 — 안전한 등록·복구 공용 쓰기 계약
- **Depends on:** Task 03.
- **목적:** 기존 공개 RPC 호환을 유지하면서 서버 전용 Catalog transaction 준비.
- **현재 구조:** 072 create/restore RPC는 auth.uid() 및 명시적 컬럼 목록 사용.
- **변경 대상:** 새 migration `*_catalog_product_write_contract.sql`, `src/types/supabase.ts`, 예정 `supabase/tests/catalog_product_write_contract.sql`.
- **구현 요구사항:** 기존 공개 wrapper 서명 유지, 필요한 최소 내부 helper만 추출. Catalog insert-if-absent + product 생성/복구 + inventory를 server-only 단일 transaction으로 연결. request_id 재시도 지원. direct 편집 시 GTIN 변경에 따른 catalog unlink/재확인 guard.
- **설계 결정:** 내부 helper PUBLIC/anon/authenticated execute 제거. 서버가 검증한 actor/store를 재검증하며 source/confidence는 client payload 불신. 수동 경로는 catalog=null 가능.
- **변경 금지 영역:** B, 기존 auth 체크 약화, 범용 arbitrary JSON update/RPC 도입.
- **완료 조건:** 기존 클라이언트 RPC 호환; 재시도 중복 없음; 실패 시 부분 저장 없음; 타 매장/삭제 계정 거부. catalog-only 충돌은 원본 덮어쓰지 않음.
- **검증:** S(동시 GTIN, request 충돌, rollback 포함) + V.
- **결과 보고:** R, Edge가 사용할 정확한 server-only API 및 인증 경계. 범위가 커지면 분리 요청 후 STOP.

### Luna Task 05 — 병합·해제 Catalog 보존
- **Depends on:** Task 04.
- **목적:** 매장 alias와 글로벌 Catalog 혼동 방지.
- **현재 구조:** 071 product_alias_links/product_snapshot, 072 register-and-merge, 074 alias-aware operations.
- **변경 대상:** 새 migration `*_catalog_alias_preservation.sql`, 예정 `supabase/tests/catalog_alias_contract.sql`; 타입 변경은 필요한 경우만.
- **구현 요구사항:** survivor Catalog 유지, alias metadata 보존/해제 복원, 신규 등록 후 병합 경로도 동일. 서로 다른 catalog가 존재하면 혼합 상태를 읽어 판단 가능하도록 계약 정의.
- **설계 결정:** 병합이 글로벌 GTIN mapping을 변경하지 않음. Catalog 관계로 자동 병합하지 않음.
- **변경 금지 영역:** B, 수량 병합/배분 알고리즘·기존 log 의미.
- **완료 조건:** A/B 다른 Catalog 병합→해제에서 원래 metadata/수량 검증, legacy snapshot 필드 없는 행 호환.
- **검증:** S + V.
- **결과 보고:** R, 혼합 품목을 UI/Commerce가 판별하는 방법.

## Phase 2 — Barcode Lookup

### Luna Task 06 — Candidate 계약과 내부 Catalog 조회
- **Depends on:** Task 02, Task 03.
- **목적:** UI를 provider와 분리하되 얇은 서비스 유지.
- **현재 구조:** DatabaseService/EdgeFunctionService 이미 존재.
- **변경 대상:** 예정 `src/types/productLookup.ts`, `src/services/catalog/ProductLookupService.ts`, `src/services/index.ts`, `tests/product-lookup-service.test.mjs`.
- **구현 요구사항:** ProductCandidate와 hit/miss/invalid/unavailable/rate_limited 결과; GTIN 단건 Catalog 조회; 오류와 MISS 분리.
- **설계 결정:** UI 직접 Supabase 금지. 클래스/팩토리/DI 없음. catalog HIT에 외부 API 호출 0.
- **변경 금지 영역:** B, 범용 DatabaseService fluent 계약 변경.
- **완료 조건:** HIT/MISS/error 및 null metadata를 실행 테스트로 검증.
- **검증:** targeted test + V.
- **결과 보고:** R, Edge candidate와 공유할 직렬화 계약.

### Luna Task 07 — Open Food Facts adapter
- **Depends on:** Task 06, Orchestrator의 OFF 라이선스/사용 범위 승인.
- **목적:** OFF 응답을 검증된 후보로 변환.
- **현재 구조:** 외부 호출은 Edge; 기존 recipe-import fetch 패턴 참고.
- **변경 대상:** 예정 `supabase/functions/product-lookup/openFoodFacts.ts`, `openFoodFacts.test.ts`.
- **구현 요구사항:** 공식 v3 응답 계약 고정, 필드 최소화, custom User-Agent, abort timeout, 반환 GTIN 일치 확인, 한국어명 우선, 단순 규격만 파싱.
- **설계 결정:** fetch adapter 함수 하나. raw response 영구 저장/상품 데이터 자동 기여 없음. fixture는 명시적 테스트 데이터.
- **변경 금지 영역:** B, production API 대량 호출/권한 없는 이미지 복제.
- **완료 조건:** found/missing/no-name/partial/malformed/429/timeout/다른 GTIN 테스트.
- **검증:** E. 실제 endpoint smoke는 별도 제한된 staging 확인.
- **결과 보고:** R, 고정 API version/필드/규격 parsing ceiling.

### Luna Task 08 — 인증된 조회 Edge와 비용 제한
- **Depends on:** Task 06, Task 07.
- **목적:** 순차 조회와 공용 rate budget을 안전하게 노출.
- **현재 구조:** recipe-import가 JWT 확인, secrets를 Deno.env로 읽음.
- **변경 대상:** 예정 `supabase/functions/product-lookup/index.ts`, `index.test.ts`, `supabase/config.toml`, 필요 최소 quota migration/SQL test.
- **구현 요구사항:** JWT/현재 store·활성 계정 검사, 입력 검증, Catalog 재확인, OFF 순차 호출, 5초 총 예산, 공유 quota, signed candidate token(user/store/GTIN/source/expiry binding).
- **설계 결정:** Web Crypto; service_role client 노출 금지. Catalog lookup 자체가 저장을 수행하지 않음. quota 실패시 수동 fallback 결과.
- **변경 금지 영역:** B, Redis/queue, provider 병렬 호출, client의 source 신뢰.
- **완료 조건:** quota 다중 호출·token tamper·user/store binding·abort·miss/error 구분 검증.
- **검증:** E + quota S + V.
- **결과 보고:** R, 제한값/secret 이름(값 금지)/배포 전제. quota+token이 과도하게 커지면 Orchestrator에 Task 분할 요청.

### Luna Task 09 — 선택된 Generic provider adapter
- **Depends on:** Task 08, Orchestrator의 공급자 선정·저장/재배포 권리·예산 승인.
- **목적:** OFF MISS의 실제 coverage 보완.
- **현재 구조:** Task 06 공통 결과, Task 08 순차 pipeline.
- **변경 대상:** 예정 `supabase/functions/product-lookup/genericProvider.ts`, adapter test, index의 MISS 분기.
- **구현 요구사항:** 선정된 한 공급자만, 검증·quota·timeout/비용 기록, OFF MISS일 때만 호출. 공급자 미선정이면 실행하지 않음.
- **설계 결정:** V1 필수 dependency 아님. 빈 adapter나 가짜 HIT 구현 금지.
- **변경 금지 영역:** B, 사용자가 모르는 유료 API 활성화.
- **완료 조건:** 실제 공급자 계약 기반 fixture와 비용 상한 검증.
- **검증:** E + V, 승인된 소량 실조회 별도.
- **결과 보고:** R, 추가 HIT당 비용 측정 방법 및 계약 제약.

## Phase 3 — Product Confirmation UX

### Luna Task 10 — 스캔 형식 보존
- **Depends on:** Task 02.
- **목적:** UPC-E/GTIN-8 오인 방지.
- **현재 구조:** nativeBarcodeScanner는 rawValue만; ScanPage는 barcode route 전달.
- **변경 대상:** `src/lib/nativeBarcodeScanner.ts`, `src/lib/webBarcodeScanner.ts`, `src/pages/ScanPage.tsx`, `src/types/domain.ts`, 관련 scanner test.
- **구현 요구사항:** 이용 가능한 symbology를 optional metadata로 전달; pending entry와 route에서 보존. 형식 없는 입력은 ambiguous를 구분. 기존 내부 resolver는 raw barcode로 먼저 조회.
- **설계 결정:** scanner 교체/카메라 설정 변경 없음. metadata 없는 legacy entry 지원.
- **변경 금지 영역:** B, native/web duplicate navigation refs와 TTL 의미.
- **완료 조건:** 등록된 barcode 경로 불변; UPC_E를 GTIN-8 외부 조회하지 않음; pending/native→web 전환 검증.
- **검증:** V + native/web 수동 체크는 테스트 환경에서만.
- **결과 보고:** R, 실제 각 플랫폼의 format 지원/미검증 목록.

### Luna Task 11 — 상품 후보·직접 입력 UI
- **Depends on:** Task 06, Task 08, Task 10.
- **목적:** 미등록 barcode에서 후보 확인 후 기존 폼 자동 채움.
- **현재 구조:** ProductEditPage 등록/편집 공용, useState 저장.
- **변경 대상:** `src/pages/ProductEditPage.tsx`, 예정 `src/components/ProductCandidateCard.tsx`, UI 계약 test.
- **구현 요구사항:** 등록 모드만 lookup, 후보 맞아요/직접 수정/직접 입력; image fallback/출처; abort/late response guard; 단위당 규격 확인.
- **설계 결정:** 후보 확인은 로컬 draft만 수정. 사용자가 수정한 필드는 늦은 응답이 덮어쓰지 않음. 편집 진입 시 자동 조회 금지.
- **변경 금지 영역:** B, 실제 재고 저장/API side effect.
- **완료 조건:** HIT/MISS/timeout/offline/바코드 변경/취소에서 수동 입력 가능; label/keyboard/모바일 버튼 검증.
- **검증:** targeted UI/state test + V.
- **결과 보고:** R, 미구현 저장 연결은 Task 13이라고 명시.

### Luna Task 12 — 확인 저장 Edge
- **Depends on:** Task 04, Task 08.
- **목적:** 공용 데이터 오염 없는 원자적 저장 경계.
- **현재 구조:** Task 04 server-only transaction, Task 08 signed candidate.
- **변경 대상:** 예정 `supabase/functions/product-confirm/index.ts`, `index.test.ts`, `supabase/config.toml`.
- **구현 요구사항:** JWT 재검증, token expiry/user/store/GTIN 검사, 원본 candidate와 로컬 override 분리, request_id 전달, server-only RPC 호출.
- **설계 결정:** canonical 원본 충돌시 overwrite 금지. 클라이언트 verified_at/actor/source 무시. manual-only는 기존 등록 경로 유지.
- **변경 금지 영역:** B, service key를 UI로 반환, auth guard bypass.
- **완료 조건:** 위조/만료/타매장/중복 요청 거부 또는 idempotent 결과; transaction 실패 정상 오류 반환.
- **검증:** E + 실제 isolated DB 연동 S + V.
- **결과 보고:** R, HTTP 결과와 retry/uncertain 계약.

### Luna Task 13 — 최종 등록/편집 저장 연결
- **Depends on:** Task 05, Task 11, Task 12.
- **목적:** 후보 확인→Catalog 연결→기존 inventory 생성 흐름 완성.
- **현재 구조:** ProductEditPage handleSubmit에 생성·복구·직접 수정 분기.
- **변경 대상:** `src/pages/ProductEditPage.tsx`, `src/services/catalog/ProductLookupService.ts`, 저장 테스트.
- **구현 요구사항:** 확인된 후보의 최종 저장만 confirm Edge 호출; 수동 등록 기존 RPC; 재시도 request 유지; barcode 수정시 unlink/reconfirm; image/brand snapshot 표시.
- **설계 결정:** 품목 저장 성공 후 기존 operation 이동, 재고 초기 0. lookup 장애가 수동 저장을 막지 않음. 애매한 저장 결과를 재시도 전에 새 request로 만들지 않음.
- **변경 금지 영역:** B, 모바일 재고량 자동 저장.
- **완료 조건:** 신규/기존 활성/비활성 복구/alias conflict/수동/missing catalog/권한 실패 end-to-end 확인.
- **검증:** V + isolated DB/UI 통합; 구형 payload replay.
- **결과 보고:** R, feature flag/적용 순서와 남은 기기 검증.

## Phase 4 — Real-world Accuracy Test

### Luna Task 14 — 최소 Lookup 측정 기록
- **Depends on:** Task 13.
- **목적:** HIT와 사용자 확인/수정을 분모까지 측정.
- **현재 구조:** 조회·확인 event가 분리됨, telemetry 전용 구조 없음.
- **변경 대상:** 새 `*_product_lookup_metrics.sql`, product-lookup/product-confirm의 최소 event 기록, SQL/Edge tests.
- **구현 요구사항:** lookup_id·GTIN·format·stage·hit/miss/error·latency·confidence·confirmed/edited/time. user/store 식별은 권한 검증에 필요한 최소 범위, 이메일/원본 JSON 금지; retention 제한.
- **설계 결정:** provider별 outcome과 overall outcome 구분. metrics 실패가 저장 실패를 만들지 않음. 공개 임의 metric write 금지.
- **변경 금지 영역:** B, 분석 SaaS/대시보드 추가.
- **완료 조건:** 중복 confirmation event 억제, store RLS/retention, 성공률 부풀리는 기록 없음.
- **검증:** S + E + V.
- **결과 보고:** R, denominator/export 계약.

### Luna Task 15 — 실물 Dataset Runner
- **Depends on:** Task 14, 사용자 검증 실물 dataset 100~300개.
- **목적:** 한국 매장 실제 coverage와 오매칭 검증.
- **현재 구조:** Node test 사용 가능, 실물 dataset 아직 없음.
- **변경 대상:** 예정 `scripts/evaluate-product-lookup.mjs`, `docs/stockly-lookup-evaluation.md`; 사용자 데이터는 승인된 비공개 경로.
- **구현 요구사항:** CSV 입력/출력, cold/warm 별도, 중복 GTIN 분리, HIT/전체 성공/이미지/브랜드/규격/오매칭/수정/latency/429 지표. quota pacing, 재개 가능 결과 저장.
- **설계 결정:** 합성 테스트 fixture와 실물 평가를 표시로 구분. dataset 없으면 harness만 완료, 정확도는 미검증.
- **변경 금지 영역:** B, 허가 없는 bulk API/운영상품 데이터 수집.
- **완료 조건:** runner self-test 및 실제 제공 dataset 수/처리수 대조. 오매칭 ground truth 사용자 확인.
- **검증:** runner test + 승인된 실평가 명령/결과, V.
- **결과 보고:** R, 분자/분모·누락·실제 표본 수. 오매칭 수정은 별도 좁은 후속 Task 요청.

### Luna Task 16 — V1 통합 회귀 및 출시 게이트
- **Depends on:** Task 15; generic 사용 시 Task 09 포함.
- **목적:** 기능 안정성 확인 후 V1 범위 종료.
- **현재 구조:** 설계 K의 전체 회귀 행렬.
- **변경 대상:** 예정 `docs/stockly-catalog-release-checklist.md`, 발견한 결함은 수정하지 않고 보고.
- **구현 요구사항:** 등록/편집/scanner/입출고/이동/실사/프랩/폐기/로그 복원/URL/SMS/auth/store RLS 검증. 권리·schema·feature flag 확인.
- **설계 결정:** CI 녹색과 실기기 완료는 다름. 테스트 매장만.
- **변경 금지 영역:** B, 자동 배포·실제 Affiliate 반복 클릭.
- **완료 조건:** 검증 증거/미검증/차단 목록. Orchestrator가 V1 통과 또는 수정 Task 결정.
- **검증:** V + S + 테스트 매장 기기/브라우저 검증.
- **결과 보고:** R, production 준비 여부는 근거와 함께.

## Phase 5 — Commerce Product

### Luna Task 17 — Offer 및 매장 선택 관계
- **Depends on:** Task 16, 수동 입력 데이터와 외부 데이터 권리 경계 승인.
- **목적:** 실상품과 판매 옵션 분리.
- **현재 구조:** product_url만 존재, confirmed_order_items 재사용 가능.
- **변경 대상:** 새 `*_commerce_products.sql`, domain/supabase types, SQL tests.
- **구현 요구사항:** 설계 J의 commerce_products/product_commerce_links, store scope, preferred unique, pack/option/vendor 문자열 식별자. 공용 확인 매칭과 매장 선택 분리.
- **설계 결정:** 가격/이력 컬럼은 아직 구현하지 않음. 식별 불명 링크는 nullable ID, 잘못된 전역 GTIN 매칭 금지.
- **변경 금지 영역:** B, product_url 제거·새 발주 상태 머신.
- **완료 조건:** 타 매장 연결 거부, 공용 overwrite 거부, 중복 preferred/ID 충돌 검증.
- **검증:** S + V.
- **결과 보고:** R, 미확정 Offer 처리.

### Luna Task 18 — 수동 Offer 연결과 URL 호환
- **Depends on:** Task 17.
- **목적:** 가격 없이 구매 링크 연결부터 검증.
- **현재 구조:** ProductEditPage product_url, ProductOrderAction 공통 URL/SMS.
- **변경 대상:** ProductEditPage, 예정 `src/services/commerce/CommerceService.ts`, 최소 link RPC migration/tests.
- **구현 요구사항:** 사용자가 URL/포장/옵션 확인 저장; preferred link와 product_url 원자적 동기화; 직접 URL 변경시 오래된 연결 해제.
- **설계 결정:** HTTPS/허용 scheme 검증, URL metadata scraping 없음. 혼합 catalog 제품 자동 추천 금지.
- **변경 금지 영역:** B, 임의 Affiliate 자동 변경.
- **완료 조건:** legacy 앱 URL 유지, SMS 영향 없음, 입력 링크를 canonical 정보로 승격 안 함.
- **검증:** S + V + URL action mock.
- **결과 보고:** R, 단위 확인/매칭 수정 흐름.

## Phase 6 — Coupang Integration

### Luna Task 19 — 공식 승인된 쿠팡 adapter
- **Depends on:** Task 18, Orchestrator의 계정/API/매체/표시/저장 권리 승인.
- **목적:** 허용된 검색·Deep Link 경로만 연결.
- **현재 구조:** 수동 Offer 연결은 독립적으로 작동.
- **변경 대상:** 예정 `supabase/functions/commerce-lookup/index.ts`, `coupang.ts`, tests/config.
- **구현 요구사항:** 승인된 endpoint/schema/rate budget만 사용. GTIN 직접 매칭 지원 확인 없으면 name/brand/size 후보 검색. 허용되지 않은 응답 저장 금지.
- **설계 결정:** 판매자 관리 API를 시장 검색으로 대체하지 않음. 키는 서버에만. 가격 이력 활성화 금지.
- **변경 금지 영역:** B, 크롤링/anti-bot 우회/가짜 API.
- **완료 조건:** 공식 문서 버전·권한·quota가 작업지시 부록으로 고정되고 adapter contract test 통과.
- **검증:** E + V, 승인된 소량 smoke.
- **결과 보고:** R, 허용/불허 필드와 TTL. 계약 없으면 BLOCKED 반환.

### Luna Task 20 — 후보 Offer 확인 및 구매 버튼
- **Depends on:** Task 19.
- **목적:** 부족재고에서 사용자가 확인한 판매 상품 열기.
- **현재 구조:** LowStockPage/InventoryListPage가 ProductOrderAction 사용.
- **변경 대상:** ProductEditPage의 Offer 후보 UI, ProductOrderAction, 필요 최소 caller props/tests.
- **구현 요구사항:** pack/size/option/seller 확인, 선택 저장; 제휴 표시 요구사항 적용; 사용자 클릭으로만 열기.
- **설계 결정:** 버튼 클릭은 발주/입고/구매 완료가 아님. native external open 경로는 기존 helper 먼저 찾아 재사용.
- **변경 금지 영역:** B, 자동 redirect/숨겨진 광고 호출/receipt_check_only 버튼 숨김.
- **완료 조건:** URL/SMS/native/web 버튼 동작과 사용자의 매칭 수정 검증.
- **검증:** V + mock opener/UI tests; live 무효 클릭 유발 금지.
- **결과 보고:** R, 실제 구매 완료 추적 불가 여부 명시.

## Phase 7 — Purchase Flow Validation

### Luna Task 21 — 구매 연결 가치 측정
- **Depends on:** Task 20.
- **목적:** 가격 추적 개발 전 사용 가치 확인.
- **현재 구조:** 부족 표시와 버튼, 확인된 매칭.
- **변경 대상:** 최소 store-scoped event 기록 및 export, 예정 `docs/stockly-commerce-validation.md`.
- **구현 요구사항:** 부족 품목 노출→연결 클릭, 매칭 성공/수정, 버튼 이용을 세션/일별 중복 기준과 함께 측정. 파트너스 기밀 통계를 공개 보고서에 넣지 않음.
- **설계 결정:** Stockly 자체 이벤트와 쿠팡 전환 리포트를 혼합하지 않음. 실제 주문 정보 수집 없음.
- **변경 금지 영역:** B, 클릭으로 재고/발주 완료 변경.
- **완료 조건:** 분자/분모 있는 실제 사용 데이터 또는 미확보 상태 명시. Orchestrator가 가격 단계 진입 결정.
- **검증:** event tests + V, 실제 pilot export는 승인 범위만.
- **결과 보고:** R, 가격 개발의 가치 게이트.

## Phase 8 — Price History (현재 권리 승인 전 BLOCKED)

### Luna Task 22 — 허용된 가격 이력 저장 계약
- **Depends on:** Task 21, 장기 저장·가공·표시·retention 서면 허용.
- **목적:** 동일 Offer/가격 조건별 관측값 저장.
- **현재 구조:** 가격 없는 commerce_products.
- **변경 대상:** 새 `*_offer_price_history.sql`, types, SQL tests.
- **구현 요구사항:** price_history, currency/basis/availability/shipping, day uniqueness, index; current price 동시 갱신용 server-only transaction.
- **설계 결정:** daily snapshot, 0원=실패 금지, 회원/쿠폰 조건 분리, numeric 금액.
- **변경 금지 영역:** B, 약관 제한 회피·승인 기간 초과 저장.
- **완료 조건:** replay 중복/option 혼합/실패가 0원으로 유입/권한 위반 방지.
- **검증:** S + V.
- **결과 보고:** R, 적용된 계약상 retention.

### Luna Task 23 — 제한된 가격 수집 scheduler
- **Depends on:** Task 22, 현재가 수집 공식 권한/예산.
- **목적:** 활성 Offer만 정해진 주기로 수집.
- **현재 구조:** pg_cron/Vault cleanup scheduler 패턴 존재.
- **변경 대상:** 예정 `supabase/functions/offer-price-refresh/index.ts`, tests, scheduler SQL/config.
- **구현 요구사항:** distinct 활성 대상, bounded batch/quota/retry/next-check, secret 인증, dry-run/kill switch, 성공 관측만 저장.
- **설계 결정:** 기존 scheduler 재사용 방식, 별도 queue/daemon 없음. 초기 일 1회.
- **변경 금지 영역:** B, cron 운영 활성화/secret 값 출력/페이지 크롤링.
- **완료 조건:** 중복 worker/retry/429/partial batch/price stale 동작 검증. 실제 배치는 승인 후 별도.
- **검증:** E + S + V.
- **결과 보고:** R, 예상 호출량·상한·실패 시 재고 기능 무관 증거.

### Luna Task 24 — 가격 통계와 보관 정책
- **Depends on:** Task 23.
- **목적:** 오해 없는 7/30일 통계 제공.
- **현재 구조:** daily snapshot, success checked_at.
- **변경 대상:** 새 SQL stats/retention migration 또는 허용 운영 SQL, CommerceService, SQL tests.
- **구현 요구사항:** 현재/평균/최저/현재 대비 비율, sample_count/coverage/stale/basis; retention과 기간 라벨. 0 평균 분모 보호.
- **설계 결정:** SQL query/RPC + index. MV/partition 없음. lifetime 최저 보존 근거 없으면 보관기간 최저.
- **변경 금지 영역:** B, missing day 임의 채움/다른 옵션 통계 혼합.
- **완료 조건:** 불규칙/결측/통화·basis 다른 표본/retention 이후 라벨 정확성.
- **검증:** S + V + DB 크기/쿼리 성능 측정은 테스트 데이터만.
- **결과 보고:** R, 실측 성능과 retention ceiling.

## Phase 9 — Price Alert

### Luna Task 25 — 앱 내 규칙 기반 가격 알림
- **Depends on:** Task 24.
- **목적:** target/relative/recent-low를 중복 없이 표시.
- **현재 구조:** 가격 통계 API 있음, 알림 전달 채널 미확정.
- **변경 대상:** 최소 alert rule/state migration/types, 예정 `src/lib/priceAlerts.ts`, LowStock의 작은 표시/tests.
- **구현 요구사항:** 사용자 target, 평균 대비 하락, 최근 최저; stale/coverage 제외, threshold crossing/cooldown, store RLS.
- **설계 결정:** 앱 내 알림 우선, 푸시/SMS/email/LLM 없음. 통계 근거 표시.
- **변경 금지 영역:** B, 가격만으로 자동 발주, 사용자 동의 없는 외부 메시지.
- **완료 조건:** 경계값/중복/가격 복귀/결측/수정/삭제 테스트.
- **검증:** pure rule tests + S + V.
- **결과 보고:** R, 알림 전달 채널 확장이 필요한 시점.

## Phase 10 — Inventory Intelligence

### Luna Task 26 — 소비 집계 계약
- **Depends on:** Task 16; 가격 없이도 독립 가능하나 실행 순서는 Orchestrator 지정.
- **목적:** 수량 감소와 실제 운영 소비 분리.
- **현재 구조:** 074 프랩 원재료는 출고 log, 완제품 제조/소진/폐기 별도, restore/reverted metadata.
- **변경 대상:** 예정 SQL consumption RPC/test, `src/types` 최소 확장.
- **구현 요구사항:** 관련 restore RPC 먼저 읽고 유효 기록 판정. 출고+프랩 원재료 이중합산 방지; 이동/실사/병합/메모 제외; 폐기 별도 손실. 실제 관측일수와 단위 반환.
- **설계 결정:** 30일 단순 평균, 부족 관측/0 소비/receipt_check_only/혼합 단위 null. UI 500개 상한을 전체 분석 분모로 쓰지 않음.
- **변경 금지 영역:** B, 과거 log 일괄 rewrite·판매량으로 과장.
- **완료 조건:** 제조→소진→폐기→복원/병합 timeline fixture의 기대 소비와 일치.
- **검증:** S + V.
- **결과 보고:** R, 해석 불가능한 historical event와 제외 범위.

### Luna Task 27 — 소진일·발주 추천 규칙
- **Depends on:** Task 26, 가격 결합에는 Task 24.
- **목적:** 재고 위험을 우선하는 설명 가능한 추천.
- **현재 구조:** minimum_stock, quantity, usage, optional Offer price stats.
- **변경 대상:** 예정 `src/lib/reorderRecommendation.ts`, tests; lead_time_days nullable migration/types.
- **구현 요구사항:** days remaining·lead time·안전재고 조합, 충분/부족×가격 높음/정상/낮음; null 데이터 guard, 유통기한 없는 선구매는 단순 검토 안내.
- **설계 결정:** 기존 minimum_stock 재사용. LLM/ML/계절성/자동 구매 금지. 가격 없으면 재고 기준만.
- **변경 금지 영역:** B, 재고 부족을 가격 할인 대기로 미루기.
- **완료 조건:** 네 가지 추천 case 및 기록부족/0소비/negative-invalid/stale/단위불일치 tests.
- **검증:** pure rule tests + S + V.
- **결과 보고:** R, 실제 임계값/근거 및 조정 가능한 최소 설정.

### Luna Task 28 — 부족재고 추천 표시·최종 검증
- **Depends on:** Task 27, 가격 알림 사용 시 Task 25.
- **목적:** 기존 업무 흐름에 근거 있는 추천만 얹기.
- **현재 구조:** LowStockPage와 ProductOrderAction, 기존 확정/긴급 상태.
- **변경 대상:** LowStockPage, 필요한 작은 공통 컴포넌트/test, release checklist.
- **구현 요구사항:** 소진 추정/관측기간/가격 기준시점/추천 이유 표시; 부족정보는 정직하게 생략; 기존 발주 동작 유지.
- **설계 결정:** 추천은 보조 정보, 기존 부족 판정 대체 금지. 구매 버튼과 저장 분리.
- **변경 금지 영역:** B, 전체 UI 개편/성공률 과장/운영 자동 구매.
- **완료 조건:** 전 회귀 행렬 재검증, 계약·privacy·매장 경계 확인, 미검증 항목 명시.
- **검증:** V + S + 테스트 매장 UI/native 검증.
- **결과 보고:** R, 최종 출시 여부는 Orchestrator 검토와 사용자 배포 승인으로 결정.

## 의존성과 진행 규칙 요약

- Phase 1~4가 V1. Task 09는 공급자 승인 시에만 추가하며 V1을 불필요하게 막지 않는다.
- Task 02/03 이후 일부 설계상 독립 작업은 가능하지만 기본 실행은 한 Task씩. 공용 types/migration/서비스는 병렬 수정하지 않는다.
- Phase 6 공식 API 승인 미완료라도 Task 18의 수동 구매 연결은 독립적으로 가치 검증할 수 있다.
- Phase 8~9는 가격 저장 권리 승인 없으면 실행 금지. Phase 10의 재고 기반 예측은 가격 없이 별도로 가능.
- 각 Task 결과를 Orchestrator가 요구충족→아키텍처/RLS→회귀→불필요 diff 순서로 읽고 승인한다. 결함이 있으면 해당 Task의 좁은 수정 지시만 내린다.
- 정책/실DB/실물 데이터에 의존하는 미래 Task는 **조건부 명세**다. 해당 gate에서 실제 자료를 확인하고 endpoint/migration 번호 등 실행값을 고정한 다음에만 Luna에 전달한다.
