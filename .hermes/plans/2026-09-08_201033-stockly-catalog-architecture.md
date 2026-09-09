# Stockly Inventory Intelligence Implementation Plan

**Goal:** 기존 재고 기능을 보존하면서 바코드 상품 식별을 먼저 완성하고, 구매 연결과 허용된 가격 데이터 활용을 단계적으로 추가한다.

**Architecture:** React + Supabase 유지. 매장 품목·실재고·글로벌 상품·판매 Offer를 분리한다. 기존 서비스/RPC와 품목 등록 화면을 재사용한다.

**Tech Stack:** React 18, TypeScript, Vite 6, Supabase/Postgres/Edge Functions, Capacitor 8, MLKit, html5-qrcode.

**작업 방식:** Orchestrator가 조사·설계·리뷰, codex-luna가 구현·SQL·테스트·빌드. 이 문서는 구현 승인이 아닌 Phase 0 결과다. Luna는 동반 Task 문서의 작업을 하나씩 받고, 리뷰 통과 전 다음 작업을 시작하지 않는다.

## 조사 범위와 검증 상태

- 저장소: `/Users/jinkim/Desktop/stroage-manage`, 조사 HEAD `20058ef`, main.
- 실제 소스·타입·관련 migration·서비스·테스트 계약을 읽었다. 전체 저장소 일괄 정독은 하지 않았다.
- 로컬 migration은 001~082, 82개. README의 059 설명은 현재 파일 목록보다 오래됐다.
- 운영 DB 데이터, 원격 schema, 실제 적용 migration, 배포 Edge Function/cron은 조회하지 않았다. 이하 DB 설명은 **로컬 migration과 현재 클라이언트 계약 기준**이다. 원격 일치 여부는 첫 실행 게이트다.
- build/lint/test는 이번 조사에서 실행하지 않았다. 실행 및 기준선 기록은 Luna Task 01에 포함한다.
- 기존 변경 `src/pages/HomePage.tsx`, `docs/stockly-design-guidelines.md` 및 기존 untracked 문서/백업은 보존한다.
- 기존 `stockly_barcode_coupang_implementation_plan_v2.md`는 요구 배경으로만 사용했다. 거기 등장하는 `current_quantity`, `minimum_quantity`, `order_url`을 실제 컬럼으로 간주하지 않는다.

## A. Current Architecture

### 등록 및 스캔

`ScanPage` → native MLKit 우선, web scanner fallback → `resolveProductByBarcode` → `resolve_product_by_barcode` RPC → 등록된 활성 품목이면 `operation`, 없으면 `register`.

- `products.barcode`, `product_barcodes`, 가역 병합 alias를 함께 해석한다.
- 12자리와 0으로 시작하는 13자리 후보를 조회하지만 GTIN check digit 검사는 없다.
- `ProductEditPage`가 신규 등록과 편집을 함께 담당한다.
- 신규 생성은 `create_product_with_inventory`, 비활성 상품 복구는 `restore_product_with_inventory` RPC. 수정은 store-scoped `DatabaseService.update`.
- 신규 RPC는 product와 inventory를 한 DB transaction에서 생성한다. 단순히 클라이언트 insert 두 번으로 바꾸지 않는다.
- native wrapper는 현재 `rawValue`만 반환한다. UPC_E, CODE_128 등 다양한 형식을 지원하므로 8자리 문자열을 무조건 EAN-8로 해석하면 위험하다.

### 재고 및 작업 기록

- `products`는 매장 품목/설정, `inventory`는 창고·매장 수량이다.
- `normalizeInventoryItem`이 total과 부족 여부를 계산한다.
- 현재 작업 저장은 idempotency request와 위치별 version을 사용하는 RPC 경로다. 초기 README의 직접 inventory/log 변경 설명보다 이 계약을 우선한다.
- 모바일 다이얼은 명시적 저장 버튼이 핵심 계약이다. 상품 조회/후보 확인이 재고량을 자동 저장하면 안 된다.
- 병합은 원본 product를 유지하는 `product_alias_links` 및 복원 정보를 사용한다.

### 발주

`LowStockPage` → resolved inventory → 자동 부족 + 수동 발주품목 + 긴급 → `ProductOrderAction`.

- URL 컬럼명은 `product_url`; SMS는 supplier의 `order_method`, `sms_phone`, `sms_template`를 이용한다.
- `confirmed_order_items`에는 확정 발주 및 `order_placed_at/by`가 있다. 새 구매 기능이 별도 발주 상태 머신을 만들 이유가 없다.
- 링크 클릭, 사용자가 체크한 발주 완료, 실제 쿠팡 구매 완료는 서로 다른 사건이다.

### 서비스·상태

- UI → `src/services` → Supabase. `DatabaseService`는 fluent query를 보존하는 얇은 wrapper다.
- 인증 `AuthService`, Edge 호출 `EdgeFunctionService`, 파일 `StorageService` 재사용.
- 화면의 useState/useEffect/useMemo와 AppRoute 기반 흐름을 유지한다. 새로운 전역 상태 라이브러리 불필요.
- `recipe-import` Edge Function은 JWT 사용자 확인 후 외부 API 호출, Deno secrets 사용의 참고 사례다.
- cleanup/purge scheduler와 Vault/pg_cron용 SQL이 이미 있다. 파일 존재가 운영 스케줄 활성화를 증명하지는 않는다.

## B. Relevant Files

| 파일 | 실제 역할 / 변경 방향 |
|---|---|
| `src/App.tsx:860` | register/product-edit가 동일 ProductEditPage로 연결됨. 라우팅 전면 개편 금지 |
| `src/pages/ScanPage.tsx:71,135` | 바코드 후보 및 등록/작업 분기. 기존 pending/중복 방지 보존 |
| `src/lib/nativeBarcodeScanner.ts:9,45,138` | 형식 목록, rawValue 처리. 외부 식별 시 symbology 보존 필요 |
| `src/lib/webBarcodeScanner.ts` | web fallback와 이미지 스캔 경계. 형식 전달 계약 추가 시 읽고 검증 |
| `src/lib/resolvedProducts.ts:5,38` | 병합 해석 RPC와 inventory join, 매장 scope |
| `src/pages/ProductEditPage.tsx:125,324,496` | 생성/편집 상태, 입력 payload, 저장/복구/병합 |
| `src/types/domain.ts:48,165,304` | Product, Inventory, InventoryLog 타입 |
| `src/types/supabase.ts` | DB/RPC 클라이언트 타입. 새 컬럼만 추가해서는 RPC 저장이 되지 않음 |
| `src/lib/inventory.ts:20` | 수량/부족재고 판정 기준 |
| `src/pages/InventoryOperationPage.tsx:1515` | 위치 version + idempotent 작업 저장 |
| `src/lib/mobileInventorySession.ts:33` | apply/finalize RPC |
| `src/lib/receiptCheck.ts:13` | 수량 없는 입고 확인 및 uncertain retry |
| `src/pages/LowStockPage.tsx:152,198` | resolved 목록·부족 조건·확정 발주 |
| `src/components/ProductOrderAction.tsx:29` | URL/SMS 버튼 공통 접점 |
| `src/pages/InventoryListPage.tsx` | 발주 버튼의 다른 caller, 회귀 대상 |
| `src/pages/PrepItemManagementPage.tsx`, `PrepModePage.tsx` | 프랩 기준정보/작업. V1 변경 제외 |
| `src/pages/GroupOrderCalculatorPage.tsx` | 레시피 단위 및 제품 참조, 회귀 대상 |
| `src/services/database/DatabaseService.ts` | CRUD/RPC wrapper 재사용 |
| `src/services/functions/EdgeFunctionService.ts` | 외부 조회용 Edge 진입점 |
| `src/lib/supabase.ts` | 환경변수, PKCE/session client |
| `supabase/migrations/001_initial_inventory_schema.sql` | 초기 products/inventory/log 구조 |
| `012_multi_store_roles_and_invites.sql`, `022_store_scope_product_guard.sql`, `023_limit_master_inventory_scope.sql` | store 관계·정책·자식 store guard |
| `059_security_data_protection.sql`, `064_idempotent_mutation_requests.sql`, `066_location_scoped_inventory_versions.sql` | 안전한 작업과 재시도/동시성 |
| `071_reversible_product_aliases.sql`, `072_safe_write_and_profile_apis.sql`, `074_alias_aware_inventory_operations.sql` | 현재 병합·등록·작업의 직접 의존 |
| `079_confirmed_order_placement.sql` | 확정 발주 처리자/시점 |
| `supabase/functions/recipe-import/index.ts` | 외부 API 호출/인증 패턴만 참고 |
| `supabase/config.toml`, `supabase/sql/configure_retention_cron.sql` | Edge JWT 및 기존 scheduler 배치 방식 |
| `supabase/sql/post_native_security_lockdown.sql` | migration 밖 별도 권한 축소. 실DB 확인 필요 |
| `test/*.contract.test.mjs`, `tests/*.test.mjs`, `supabase/tests/*.sql` | 기존 Node/SQL 계약 검증. 전체 동작 보장과 구분 |

위 migration 파일은 모두 `supabase/migrations/` 아래다. 새 파일 경로는 Task 문서에서 **예정**으로 표시한다.

## C. Current Database Structure

```text
stores ──< profiles (store_id, role)
  ├──< products (store_id, barcode, name, minimum_stock, product_url, ...)
  │     ├── inventory (product_id UNIQUE, warehouse_qty, store_qty,
  │     │               warehouse_version, store_version)
  │     ├──< inventory_logs (action, quantity, before/after, reverted_*, ...)
  │     ├──< product_barcodes (store_id, product_id, barcode)
  │     ├──< confirmed_order_items
  │     └── product_alias_links (매장 내 대표 product ↔ alias product)
  ├──< prep_items ──< prep_item_ingredients → products
  │                └──< prep_batches
  └──< group_order_menus / recipe ingredients / events / event items
```

- inventory 수량은 numeric(12,4), minimum_stock은 후속 migration으로 소수 지원.
- 단위는 `unit_name`(박스/낱개 등)과 `unit_weight/unit_weight_unit`, 손질 후 단위가 별개다.
- 상품 이름·barcode·supplier 등은 매장별 값이다. 현재 Product 타입에 brand/image/catalog 컬럼은 없다.
- product/inventory FK와 store 일치 trigger가 있다. 새 자식 관계도 foreign product 연결을 막아야 한다.
- RLS 정책과 SECURITY DEFINER 함수의 store 검사 방식은 완전히 동일하지 않다. 예: 023의 직접 SELECT는 current_store_id 비교, can_access_store는 master 예외를 포함한다. 새 API는 사용자 소속 매장과 활성 상태를 명시 검증하고 master의 일반 앱 사용을 확대하지 않는다.

## D. Problems / Constraints

1. **canonical 이름 충돌:** 기존 `canonical_product_id`는 매장 내 병합 대표 ID. 신규 글로벌 ID는 `catalog_id`로만 부른다.
2. **매장 통합 품목 ≠ 한 GTIN:** 서로 다른 브랜드/규격을 업무상 합친 품목이 있을 수 있다. alias/보조 barcode를 대표 품목 Catalog로 전부 승격하지 않는다.
3. **RPC allowlist:** 072 생성/복구 RPC는 insert/update 컬럼을 명시한다. nullable 컬럼 추가만 하면 새 값이 조용히 버려질 수 있다.
4. **구형 native 공존:** migration/RPC 서명 유지, 기존 JSON payload 수용. 신 UI는 schema 적용 후 활성화.
5. **UPC-E 모호성:** scanner 형식 정보가 손실된다. 외부 GTIN lookup에만 엄격한 형식·check digit 검사를 적용하고 기존 내부 바코드는 계속 조회한다.
6. **규격 오해:** 1L 상품 ≠ 재고 1박스. Catalog 규격으로 기존 수량 단위를 자동 변경하지 않는다.
7. **외부 데이터 오염:** 사용자 확인은 공용 데이터 검수와 같지 않다. 사용자 수정은 매장 로컬 값만 바꾼다.
8. **라이선스:** OFF 기반 DB의 attribution/share-alike와 유료 DB 재배포 조건이 충돌할 수 있다. 저장 전 권리 검토가 필요하다.[2][3]
9. **쿠팡 API 저장 제한:** 공식 파트너스 페이지의 Open API 약관 제5조는 제공 데이터의 복제·저장·전송 금지 문구를 명시한다. API 키를 받는 것만으로 가격 이력 저장 권한을 얻지 않는다.[4]
10. **목록 상한:** resolved helper는 기본 500개, RPC도 500 상한이다. 전체 store 분석/가격 대상 계산을 이 UI 목록으로 대체하지 않는다.
11. **테스트 품질:** 현 테스트 일부는 소스 문자열 계약이다. DB 원자성·RLS·실제 scanner 동작의 증명이 아니다.

## E. Target Architecture

```text
기존 매장 바코드 조회 ── HIT → 기존 재고 작업 (변경 없음)
          │ MISS
          ▼
GTIN 검증 → 공용 Catalog → MISS → 허용된 외부 Provider (순차)
          ▼
ProductEditPage의 상품 후보 / 직접 입력
          ▼ 사용자 확인 + 최종 저장
공용 상품 정보의 제한적 등록 + products.catalog_id 연결
          ▼
기존 products + inventory 생성 RPC / 기존 재고 작업

product_catalog ──< commerce_products ──< price_history (권리 승인 후)
       │                    ▲
       └──< products ── 선택된 Offer 연결
                 └── inventory + inventory_logs → 규칙 기반 추천
```

Price History를 Inventory의 부모로 만들지 않는다. Inventory는 가격 유무와 무관하게 살아 있어야 한다.

### V1 최소 데이터 모델

**product_catalog (새 테이블)**
- `id uuid PK`
- `gtin text NOT NULL UNIQUE`: 검증 후 14자리 비교 키. 숫자형 금지.
- `canonical_name text NOT NULL`, `brand text NULL`, `manufacturer text NULL`
- `size numeric NULL`, `unit text NULL`, `quantity_text text NULL`: 불명확한 묶음/규격은 raw label만 유지.
- `image_url text NULL`
- `source text NOT NULL`, `source_url text NULL`, `license text NULL`, `image_license text NULL`
- `confidence numeric NULL CHECK 0..1`: 확률로 광고하지 않고 provider의 품질 신호. 제공되지 않으면 null.
- `verified_at timestamptz NULL`: 신뢰 가능한 검수 시점만. 사용자 확인으로 자동 설정 금지.
- `created_at`, `updated_at`

V1은 한 검증 GTIN = 한 Catalog row. GTIN identifier를 별도 테이블로 분리하는 것은 여러 GTIN의 실제 동일성을 관리해야 할 때 한다. `barcode_type`은 GTIN 자리수와 실제 symbology를 혼동하므로 공용 Catalog 필수 컬럼에서 제외하고 lookup 입력/로그에 기록한다.

**products 확장 (nullable)**
- `catalog_id uuid REFERENCES product_catalog(id) ON DELETE SET NULL`, index.
- `brand text NULL`, `image_url text NULL`: 매장에 확인 저장된 snapshot/override. `name`은 기존 필드 재사용.
- `catalog_confirmed_at timestamptz NULL`: 매장의 확인 시점. 공용 검수와 구분.
- 외부 이미지의 출처/라이선스는 연결된 Catalog에서 조회한다. 사용자가 URL을 바꾼 경우 출처를 분리할 최소 metadata를 추가하거나 초기 UI에서 임의 URL 편집을 막는다. 자동으로 저작권을 포기한 이미지로 취급하지 않는다.
- 재고 단위는 기존 unit 필드 재사용하되 단위당 규격 확인을 거친다. 별도 custom_name/current_quantity/minimum_quantity/order_url 컬럼은 만들지 않는다.

**저장 권한**
- Catalog read: 인증 사용자용 읽기. 개인정보·매장 정보·raw provider 응답은 포함하지 않는다.
- 일반 사용자 direct insert/update/delete 및 공개 SECURITY DEFINER upsert 금지.
- Edge는 provider 원본 후보를 짧은 만료시간의 서버 서명 token으로 반환한다. token은 candidate/GTIN/source/user/store/expiry를 묶으며 클라이언트가 source/confidence를 조작할 수 없어야 한다. Web Crypto 사용, 별도 JWT 라이브러리는 불필요.
- 확인 시 Edge에서 사용자 재인증 및 token 검증. 허용 provider 원본만 service-only RPC로 insert-if-absent. 충돌 시 canonical 내용을 덮어쓰지 않는다.
- 사용자의 수정값은 products snapshot에만 저장. manual-only 결과는 V1 공용 Catalog에 넣지 않고 catalog_id=null로 재고 등록 가능.
- server-only RPC는 user/store를 검증하고 기존 생성/복구 로직을 이용한다. 기존 함수는 auth.uid()를 요구하므로 service-role로 그대로 호출하면 안 된다. Phase 1에서 공유 private 내부 함수 + 기존 인증 wrapper를 최소 범위로 분리한다. 내부 함수는 PUBLIC/anon/authenticated 실행 권한 제거, 고정 search_path.
- Catalog/제품/재고 생성은 하나의 DB transaction. request_id UNIQUE 등 기존 idempotency 패턴 재사용. 후보 거절/미확인 상태는 DB에 저장하지 않는다.
- OFF 라이선스 처리 승인 전에는 OFF 저장·출시를 켜지 않는다. 테이블 분리만으로 라이선스 준수 완료라고 주장하지 않는다.

### GTIN 정책

- 원문 scan 값을 보존하고 기존 내부 바코드 조회를 먼저 수행한다.
- 외부 lookup은 ASCII 숫자, 길이 8/12/13/14, check digit 검증 후에만 허용.
- 비교 키는 검증한 GTIN을 왼쪽 0 padding으로 14자리 문자열화. UPC-A와 앞자리 0 EAN-13 동치 처리. 0 아닌 GTIN-14 포장 indicator는 삭제하지 않는다.
- 공백/하이픈/문자 삭제로 잘못된 코드를 몰래 고치지 않는다. 수동 입력 UX의 바깥 공백 처리를 하더라도 원문과 검증 결과를 분리한다.
- UPC-E는 GTIN-8로 간주하지 않는다. 형식이 명시되면 검증된 expansion 후 GTIN-12로 처리하거나 V1 외부 lookup 미지원 안내. format 없는 8자리 스캔은 종류 확인 없이는 자동 조회하지 않는다.
- CODE_128/매장 자체 barcode/무효 GTIN은 기존 내부 조회·직접 등록 유지.
- 동일 GTIN 다른 이름은 기존 Catalog 불변 + 로컬 override. 다른 GTIN/용량/포장 indicator는 자동 병합 금지.
- 요구서 예시 `8801234567890`은 check digit 검증 실패(계산된 마지막 숫자 3). 원문을 수정하거나 유효 fixture로 사용하지 않는다.

### 병합·해제

- 글로벌 Catalog 연결은 매장 병합의 근거가 아니다.
- survivor의 기존 catalog_id를 유지하고 alias의 Catalog를 전파하지 않는다. 서로 다른 Catalog를 합치면 UI에 혼합 품목 경고, 자동 Offer 추천/단위 가격 비교 제외.
- alias 원본과 해당 metadata를 보존하여 unmerge 후 원래 연결을 복원한다. `product_snapshot`이 JSON이라는 이유로 신규 필드 복원이 자동 된다고 가정하지 않는다.
- 혼합 상태는 활성 alias에 서로 다른 catalog_id가 존재하는지 계산한다. 처음부터 별도 상품 병합 엔진은 만들지 않는다.

## F. Database Migration Strategy

1. Luna가 isolated local DB/테스트 환경과 원격 이력 조회 권한을 확인. 원격 적용 상태·별도 lockdown SQL·grants/RLS/function definitions 차이를 읽기 전용으로 기록. 운영 row는 읽지 않는다.
2. 현 migration 순서를 처음부터 재생할 수 있는지 baseline 확인. 실패하면 신규 기능 대신 baseline 문제를 Orchestrator에 보고.
3. 새 migration으로 Catalog + nullable product 컬럼 + 제약/인덱스/RLS 추가. 기존 행은 변경/백필하지 않는다.
4. 후속 작은 migration으로 생성·복구·server-only Catalog 확인 transaction과 idempotency를 연결. 기존 공개 RPC 인자/응답 보존.
5. 병합·해제 snapshot 및 직접 편집 경로의 catalog_id/GTIN 일치 guard 보완. 바코드를 바꾸면 오래된 catalog 연결이 남지 않도록 unlink 또는 재확인.
6. types 갱신 → DB 검증 → Edge → UI 순서. migration 적용과 schema cache 확인 전 클라이언트 배포 금지.
7. feature flag 기본 off. 테스트 매장만 켠 후 정확도 테스트.
8. rollback은 기능 flag off와 이전 UI 사용. 이미 연결된 데이터를 DROP하는 down migration 금지. 필요시 후속 fix-forward.
9. 기존 데이터 연결은 별도 명시 승인된 작업으로, 유효 GTIN·활성 alias 여부·포장 단위를 제시하고 개별 확인. V1 자동 bulk backfill 금지.

번호는 다음 구현 시 최신 migration 뒤에서 정한다. 현재 082라는 이유로 병렬 실행 중 번호를 선점하지 않는다.

## G. Service Architecture

- `src/services/catalog/ProductLookupService.ts` (예정): 기존 DatabaseService로 Catalog 단건 조회, MISS일 때만 EdgeFunctionService 호출. 클래스/DI container 없음.
- `src/types/productLookup.ts` (예정): ProductCandidate와 discriminated outcome (`hit`, `miss`, `invalid`, `unavailable`, `rate_limited`) 및 provider stage timings.
- `supabase/functions/product-lookup/index.ts` (예정): JWT+store 검사, 입력 크기/GTIN 검증, Catalog 재확인, OFF → 승인된 generic 순서. auth/rate limit 오류를 MISS로 바꾸지 않는다.
- Provider는 공통 함수 타입 하나와 실제 adapter 함수. 범용 provider가 정해지기 전 빈 클래스/가짜 adapter를 만들지 않는다.
- 동일 scan 내 취소/sequence guard로 늦은 응답이 수정 중 폼을 덮어쓰지 않게 한다.
- 기본 외부 전체 timeout 목표 5초, provider별 예산 분배. 강제 자동 재시도 없음, 429 Retry-After 존중. offline/timeout 시 직접 입력.
- 외부 호스트 allowlist, response/body 길이 제한, JSON shape 검증. API secrets는 Edge에만 저장. source/metadata HTML을 렌더링하지 않는다.
- lookup/confirmation rate budget은 multi-instance에서 공유되는 DB 카운터/기존 제한 패턴 사용. in-memory limiter만으로 Edge 전체 제한을 보장하지 않는다.
- Redis, queue, 독립 microservice, 범용 repository framework는 도입하지 않는다.

## H. UI Changes

- ScanPage의 등록된 상품 경로는 그대로. unknown barcode를 받은 ProductEditPage 등록 모드에서 lookup.
- 등록 화면 상단에 후보 이미지/상품명/브랜드/규격/출처, `맞아요`, `직접 수정`, `직접 입력`.
- 후보 확인은 폼 채우기만 한다. 최종 `재고에 추가` 저장 때 Catalog/품목 연결. 재고 초깃값은 기존 0이며 입고는 기존 작업 화면에서 처리한다.
- 단위당 규격을 확인하는 최소 입력: `우리 매장의 1 [낱개/팩/박스] = ...`. 불확실하면 자동 수량 변환 금지.
- 편집 진입 시 외부 재조회/덮어쓰기 금지. 바코드 변경 후 명시적 재조회 제공.
- 이미지 실패 placeholder, alt, source attribution. 후보 loading/error가 수동 저장을 막지 않는다.
- 새 route, 신규 등록 화면 복제, 목록 대규모 이미지 grid는 만들지 않는다.
- Commerce 단계는 ProductEditPage에 판매 링크/옵션 연결, LowStock의 기존 발주 버튼 재사용. SMS/receipt_check_only 유지.

## I. External API Strategy

### Open Food Facts

공식 문서는 새 연동에 v3(현재 표기 v3.6)를 권장하고 v2는 deprecated로 표시한다. 제품 읽기 15 req/min/IP, 검색 10 req/min/IP, custom User-Agent를 요구한다. 구현 시 API schema와 제한을 다시 고정한다.[1]

- 직접 GTIN lookup만 사용. search-as-you-type 및 병렬 provider fan-out 금지.
- 이름은 한국어 값 우선, 없으면 제공된 제품명. 브랜드·quantity·image 선택, 복합 규격 파싱이 불명확하면 size/unit=null.
- 반환 code의 검증/동치 검사, 이름 없음·다른 GTIN 응답은 HIT로 세지 않음.
- 허용 필드만 candidate에 전달하고 rawMetadata 전체 영구 저장 금지.
- 테스트는 deterministic fixture가 기본, 공식 staging은 계약 검증용. 실물 정확도 평가는 별도 허용/속도 제한을 준수한 생산 데이터 읽기로 분리.[1]
- 서버 egress IP 제한이 전체 매장에 영향을 준다. 캐시/제한 예산을 공유하고 초과 시 즉시 수동 입력. IP 우회로 quota를 회피하지 않는다.

OFF DB는 ODbL, 개별 내용은 DBCL, 이미지는 CC BY-SA이며 별도 권리도 있을 수 있다. 각 화면 출처 표시 및 derived database 공개 의무 범위를 검토해야 한다.[2][3]

**결정:** 상업적 폐쇄 provider와 OFF 원본을 무조건 혼합하지 않는다. 재배포 가능한 source만 공용 Catalog로 받아들이고, 권리 검토가 끝나지 않으면 해당 provider는 비활성. 별도 테이블이라는 이유만으로 share-alike를 피했다고 판단하지 않는다.

### Generic provider

아직 공급자/계약/한국 품목 coverage 미선정. mock 결과로 대체하지 않는다. 한국 카페·소모품 표본의 추가 HIT당 비용, 이미지 권리, 영구 저장/파생 DB/재배포, rate limit/삭제 의무를 비교한 후 Orchestrator가 한 공급자를 선정한다. 비활성 상태에서는 OFF MISS → 수동 입력이 정상 V1 경로다.

### 이미지/URL metadata

V1 외부 이미지 URL 참조만, 업로드/복사/cache 계층 없음. hotlink 차단·URL 변경·추적 요청·저작권·삭제 요구를 문서화한다. 임의 상품 페이지 JSON-LD → og:image 수집은 V1에서 제외. 추가 시 허용된 도메인만, redirect마다 private/link-local/localhost 차단과 크기/시간 제한을 둔다. 쿠팡 크롤링을 기본 대안으로 사용하지 않는다.

## J. Coupang Strategy

### 확인한 공식 내용

Aside 실브라우저에서 쿠팡 파트너스의 운영정책/이용약관을 읽었다. 표시된 운영정책·파트너스 약관 버전은 2026-09-07. 같은 이용약관 페이지 하단의 별도 Open API 약관은 부칙 2021-04-03이며, 제5조에 다음 원문이 있다.[4]

> 이용자는 회사가 제공하는 서비스 이용과 관련하여 API 서비스를 통해 제공된 데이터에만 접속할 수 있으며, API 서비스를 통해 제공된 해당 데이터를 복제, 저장 또는 전송할 수 없습니다.

운영정책에는 등록된 미디어 사용, API Key 공유/재판매 제한, 광고 링크·형태·갱신주기·정보 조작 금지, 무효클릭/자동 클릭 금지가 있다.[4]

**결론:** 현재 확보한 근거로 쿠팡 가격 저장·가격 장기 이력·상품정보 영구 캐시를 허용한다고 설계할 수 없다. 개별 계약/서면 승인 또는 허용된 다른 공급 경로가 필요하다. 판매자 API를 시장 전체 GTIN 검색 API로 오인하지 않는다.

| 조사 항목 | 확인 상태 / 구현 방침 |
|---|---|
| 상품 검색 API와 계정 사용 자격 | 세부 API 계약/계정 권한 미검증. 구현 전 공식 계정 문서로 확인 |
| GTIN 직접 검색 | 미확인. 보장하지 않음 |
| 현재 가격/옵션/배송 정보 | 응답 schema와 개인화 조건 미검증 |
| 가격·제목·이미지 저장 | 일반 Open API 약관 제한 확인. 개별 허용 없으면 저장 안 함 |
| 장기 이력·통계·캐시 TTL | 허용 근거 없음. 가격 단계 BLOCKED |
| endpoint별 호출 제한 | 최신 공식 수치 미확인. 블로그 숫자를 상수로 사용 안 함 |
| Affiliate/Deep Link | 등록 매체 승인·표시규칙·공식 생성경로 검증 후 활성 |
| 자동 가격 수집 | 일반 상품 페이지 무단 크롤링 금지. 공식 허용 경로만 |
| 경제적 이해관계 표시 | 실제 제휴 출시 전 최신 가이드의 문구·위치·앱 적용 확인 필수 |

### 구매 먼저

1. V2는 사용자가 선택/입력한 판매 URL을 기존 product_url과 발주 버튼으로 여는 흐름부터 검증. Affiliate 자동 전환 없음.
2. 매장별 선택 Offer는 글로벌 매칭을 덮어쓰지 않는다.
3. 공식 허용을 받은 후 후보 검색/Deep Link adapter 추가. API key는 Edge 전용.
4. 구매 버튼 클릭이 입고/발주완료를 자동 기록하지 않는다. 실제 구매 전환은 권한 있는 신뢰 가능한 데이터가 있을 때만 보고한다.
5. 테스트는 live affiliate 링크 반복 클릭 대신 mock/open URL 계약 검증. 무효 클릭을 생성하지 않는다.

### Commerce 모델 (Phase 5 이후)

- `commerce_products`: id, platform, platform_product_id(text), vendor_item_id(text nullable), option 식별자(text nullable), product_url, image_url(허용 시), option_name, seller, pack_count, quantity_per_package, quantity_unit, delivery_type, availability, source, checked_at.
- catalog_id는 검수된 공용 매칭만. 미확정 수동 URL은 nullable 가능. 매장별 link가 확인한 catalog를 별도로 보유해 한 사용자의 매칭이 타 매장을 오염시키지 않게 한다.
- `product_commerce_links`: store_id, product_id, commerce_product_id, catalog_id(nullable), is_preferred, confirmed_at, confirmed_by, matching_confidence. product/offer/catalog 관계 검증, store RLS. 한 product의 preferred는 partial UNIQUE.
- 공용 Offer의 직접 일반 사용자 수정 금지. 사용자가 입력한 자유 metadata는 매장 link에만 보관.
- pack count/quantity를 명시 확인. total_quantity와 normalized_unit_price는 계산값으로 시작; unit/배송·쿠폰 조건이 다르면 비교 불가.
- ID NULL을 0으로 바꾸지 않음. 식별 가능한 vendor/option key에 partial uniqueness; 알 수 없는 URL을 이름으로 병합하지 않음.
- 선택 링크 저장 시 product_url도 같은 transaction에서 동기화하여 구형 앱의 발주 링크 유지. 기존 직접 URL 수정은 오래된 preferred 연결을 해제하거나 재확인하도록 guard.

### 가격 모델 (Phase 8, 권리 승인 뒤)

`price_history`: id, commerce_product_id FK, price numeric, discount_price nullable, currency, shipping_fee nullable, availability, source, price_basis(비회원/회원/쿠폰 등), checked_at timestamptz, snapshot_date.

- 표본 단위는 option/vendor/pack/통화/가격 조건이 동일한 Offer. 현재가를 자주 바뀌는 대표 상품 ID에만 연결하지 않는다.
- V1 가격 추적은 일 1회 snapshot. 성공 관측만 저장, 실패/품절을 0원으로 기록하지 않는다. 재시도는 동일 day/basis UNIQUE로 중복 방지.
- 가격 변경 시만 저장하는 방식은 단순 AVG가 시간 가중 평균이 아니므로 초기에는 사용하지 않는다.
- 현재가와 last_checked는 이력 insert와 동일 transaction 갱신. failed-at/next-check는 성공 시각과 구분.
- 7/30일 평균·최저는 SQL query/RPC + `(commerce_product_id, checked_at desc)` index. 최초부터 materialized view/partition 없음.
- 평균은 관측된 일별 대표가 평균, missing day를 전일 가격으로 무제한 채우지 않는다. coverage/sample_count 함께 반환.
- 기본 raw retention 제안 365일. 허용 기간이 더 짧으면 그 기간이 우선. 오래된 집계 보관도 계약 허용 필요.
- 삭제 후 전체 역대 최저를 증명할 데이터가 없으면 `보관 기간 최저`라고 표시. 별도 누적 최저 보관이 허용되고 정확하게 유지될 때만 `추적 시작 이후 최저` 사용.
- 하루 1회, 연 365일 가정: 1천 Offer=365,000행/년, 1만=3,650,000행/년, 10만=36,500,000행/년. 행당 200 byte 가정의 payload는 각각 73MB/730MB/7.3GB; 실제 Postgres index/WAL/tuple/backup은 별도. 도구로 계산한 시나리오이며 실측 아님.
- cron은 모든 상품이 아닌 활성 연결/알림 대상의 distinct Offer만 호출, budget·backoff·kill switch 포함. 기존 pg_cron/Vault 패턴 재사용.

## K. Testing Strategy

### 기준선과 실행

Luna가 실행/보고할 공통 명령:

```sh
node --test test/*.test.mjs tests/*.test.mjs
npm run build
npm run lint
git diff --check
```

- npm test 스크립트는 현재 없다. build가 tsc -b를 포함한다.
- lint가 dist-admin/tmp 생성물 때문에 실패하면 실패 그대로 보고하고 `npx eslint src admin-console`로 소스 문제 분리. 전체 성공으로 둔갑시키지 않는다.
- SQL은 isolated DB에서 전체 migration 재생 후 `supabase/tests` 계약 실행. 실제 환경/CLI 확인 후 `supabase test db --local` 또는 `psql -v ON_ERROR_STOP=1`로 선택한다. linked 운영 DB reset 금지.
- Edge는 Deno check/test, mock fetch 기반 provider 정상/miss/timeout/429/malformed/GTIN mismatch.
- 기존 정규식 계약 외에 실행 가능한 순수 GTIN 테스트 및 DB 동시성/권한 테스트를 추가한다.

### 회귀 행렬

등록/편집/복구; 일반·receipt_check_only·보조·alias·미등록 스캔; native/web/사진; 중복 scan/화면 이탈; 입고/출고/창고↔매장/실사/메모; 모바일 명시 저장/undo/redo/24시간 label; 프랩 제조/소진/폐기; 부족/긴급/수동/확정 발주; URL/SMS; 작업로그 복원; 인증·초대·store 격리.

- 역할: anon, profile 없는 사용자, 매장 A staff/admin, 매장 B staff/admin, master. direct REST와 RPC 모두 테스트.
- forged token/source/confidence, foreign product/store, concurrent 같은 GTIN insert, 동일 request retry, transaction 실패시 Catalog/product/inventory 부분 저장 없음.
- 기존 상품 barcode 변경·catalog unlink·alias merge/unmerge·catalog 없는 레거시 payload.
- 테스트 매장만 사용. 운영 row 조회/수정 없음. 실기기/TestFlight는 사용자가 지정한 배포 채널에서 별도 승인 후.

### Phase 4 실물 정확도

실제 한국 카페·소모품 100~300개는 아직 제공되지 않았다. 결과/수치를 만들어내지 않는다. SKU/포장별 ground truth를 사용자가 확인한 dataset 준비가 필요하다.

- cold lookup(공용 Catalog 제외 외부 coverage)과 warm lookup(Catalog HIT)을 별도 측정.
- denominator: 전체 scan, 유효 GTIN, 각 provider 도달 건수, 반환 후보 수를 각각 기록.
- Catalog/OFF/generic 조건부 HIT율과 전체 기여율, 자동 식별 성공률(정답 확인됨), 이미지/브랜드/규격 존재율, 오매칭률, 수정률, timeout/429/latency p50/p95.
- confidence가 높다는 이유만으로 정답으로 세지 않음. 동일 GTIN 반복 스캔의 warm HIT로 coverage를 부풀리지 않음.
- 로깅은 lookup_id, gtin, format, stage, result, latency, confidence, confirmed/edited, event time. 사용자 이메일·원문 응답·구매 내역 수집 없음. 제한된 retention 및 인증된 기록 endpoint.
- 도구는 Node 기반 dataset runner/CSV 출력이면 충분. 대시보드·분석 플랫폼 불필요.

## L. Implementation Phases

| Phase | 범위 | 진입/종료 게이트 |
|---|---|---|
| 0 | 현재 조사 및 본 설계 | 완료 범위는 로컬 계약. live schema는 실행 전 확인 |
| 1 | GTIN, Catalog, nullable 연결, RLS/쓰기 계약 | 기준선과 migration 검증 |
| 2 | Catalog → OFF → 선택 generic | OFF 라이선스 승인, server budget |
| 3 | 후보 확인/수동 수정/등록 | 구형 계약·원자성·스캔 회귀 통과 |
| 4 | 실물 정확도 | 실물 dataset·오매칭 원인 검토, V1 출시 판단 |
| 5 | Commerce Offer + 매장 선택 | 단위·매칭·URL 보존 |
| 6 | 쿠팡 공식 검색/링크 | 계정·매체·데이터 사용 권한 확인 |
| 7 | 부족 → 구매 연결 가치 검증 | 클릭·수정·버튼 사용률, 구매완료와 구분 |
| 8 | 허용된 가격 이력/통계 | 장기 저장 권한, 비용 승인 없으면 중단 |
| 9 | 가격 알림 | stale/coverage guards·중복 알림 억제 |
| 10 | 소비량·소진·발주 추천 | 로그 의미·단위·관측기간 검증 |

### 소비속도와 추천 설계 (Phase 10)

- 기존 074 프랩 원재료 차감은 action=`출고`, note=`[프랩 제조] ...`로 기록된다. 이를 프랩 제조량과 또 합산하면 이중 계산이다.
- 원재료의 출고(프랩 포함)는 운영 소비로 시작하되 판매 수요와 동일하다고 주장하지 않는다.
- 프랩 완제품의 `프랩 제조`는 입고, `프랩 소진`은 소비, `프랩 폐기`는 손실. 이동은 총 소비 0, 실사/조정·병합·메모·수량 없는 입고는 소비 제외.
- reverted 기록 및 복원 전후 중복은 제외 규칙으로 검증. restored 상태를 단순 SQL 필터 하나로 처리할 수 있는지 관련 복원 RPC를 Phase 10 시작 시 재조사.
- 관측 30일이 확보되면 최근 30일 운영 소비/30. 신규 상품은 실제 신뢰 가능한 관측일수 기준, 짧으면 `기록 부족`.
- 소비 0/수량관리 안 함/혼합 단위/기록 불충분이면 소진일 null. Infinity/0일로 표시하지 않음.
- `days_remaining = current_quantity / average_daily_usage`; quantity와 usage 동일 재고 단위.
- lead_time_days는 매장 상품의 optional 값, minimum_stock은 기존 안전재고로 재사용. 정책 의미가 다를 때만 별도 안전재고 필드를 도입.
- urgency를 가격보다 우선. 충분+높음=기다림, 충분+낮음=선구매 검토(보관/유통기한 caveat), 부족+정상=지금 발주, 부족+높음=최소 필요량/대안. unknown price는 재고 기준 안내만.
- 최초 알림은 앱 내 표시. target/relative/recent-low 규칙, state transition 또는 cooldown으로 중복 억제. 푸시/문자/메일은 별도 동의·채널이 확인된 후.
- LLM/ML 예측, 계절성 모델, 자동 구매는 도입하지 않는다.

## M. Luna 운영 및 중간 검토

동반 파일 `2026-09-08_201033-stockly-luna-tasks.md`의 Task를 한 번에 하나씩 전달한다. 각 완료 후 Orchestrator가 실제 diff·SQL·RLS·테스트 출력·불필요 변경·회귀를 검토한다. 설계 문제 발견 시 구현 중단하고 보고한다.

### 구현 전 재검토 결과

- 기존 products/inventory 유지: 통과.
- 새 custom_name/order_url/수량 테이블 불필요: 제외.
- V1 Commerce/price/cron/ML 혼입: 제외.
- provider 클래스/DI/Redis/큐: 제외.
- token 검증·공유 rate budget·서버 전용 원자적 쓰기: 공용 Catalog 오염과 부분 저장 방지를 위해 유지.
- nullable/additive migration: 선택. 원격 drift와 재생 검증은 미완료 게이트.
- OFF 데이터 라이선스·generic 재배포 권한: 외부 연동 출시 전 미완료 게이트.
- 쿠팡 가격 저장: 현재 약관상 기본 진행 불가. 별도 허용 확인 전 Phase 8 금지.
- codex-luna 실행: PATH에서 codex/codex-luna 실행 파일은 발견되지 않았다. `.codex/config.toml`에 `model = "gpt-5.6-luna"`는 확인했으나 실행 가능성 증명은 아니다. 실제 위임 전 설치된 CLI 경로/실행 모델을 확인하고 조용히 다른 모델로 대체하지 않는다.

**현재 완료:** 조사, 목표 설계, migration/서비스/UX/외부 정책/테스트 전략 및 Task 분해.
**현재 미실행:** 코드·SQL 수정, 테스트/build/lint, DB 적용, 배포, Luna 프로세스 실행.

## Sources

[1] https://openfoodfacts.github.io/openfoodfacts-server/api
[2] https://openfoodfacts.github.io/openfoodfacts-server/api/tutorials/license-be-on-the-legal-side
[3] https://wiki.openfoodfacts.org/ODBL_License
[4] https://partners.coupang.com

쿠팡 출처는 공개 홈페이지의 `약관 및 정책 → 이용약관` 하단 Open API 약관, `운영정책`을 Aside 실브라우저에서 읽은 것이다. API 저장 제한은 파트너스 페이지에서 직접 원문 확인했으며, 검색에 잡힌 판매자 약관을 대신 적용한 것이 아니다.
