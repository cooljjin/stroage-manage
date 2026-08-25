# Stockly 바코드·커머스·Inventory Intelligence 구현 계획

> **For Hermes:** 이 문서는 구현 전에 검토할 계획서다. 실행 시에는 이 문서를 기준으로 작업하되, 각 코드 작업은 테스트를 먼저 작성하고 실제 결과를 확인한다.

**작성 시각:** 2026-08-25 08:48 KST
**대상 저장소:** `/Users/jinkim/Documents/storage manage`
**현재 브랜치:** `codex/inventory-wheel-smooth`
**계획 파일:** `.hermes/plans/2026-08-25_084828-stockly-barcode-commerce-inventory-intelligence.md`

**Goal:** 바코드로 상품 정체성을 안정적으로 확인하고, 허용된 외부 상품·가격 데이터와 매장별 재고를 분리해 재구매 및 설명 가능한 발주 추천으로 연결한다.

**Architecture:** Stockly가 소유하는 공용 표준 Catalog와 매장별 운영 데이터를 분리한다. 쿠팡은 전체 상품 DB가 아니라 허용된 구매 오퍼·제휴 채널로만 연결하며, 외부 데이터는 출처·라이선스·관측 시각·신뢰도를 보존한다. 외부 API 또는 가격 수집 경로가 확정되기 전에는 가격 추적 기능을 구현하지 않는다.

**Tech Stack:** React 18, TypeScript, Vite, Supabase, Supabase Edge Functions, Capacitor iOS/Android, PWA, 기존 `products`/`product_barcodes`/`inventory`/`inventory_logs` 흐름.

---

## 0. 이번 계획에서 먼저 고정하는 원칙

1. **쿠팡의 수집 방식을 추측하지 않는다.** 폴센트의 공개 앱 설명과 사용 흐름은 벤치마킹 자료로만 사용하고, 실제 백엔드가 공식 API인지, 허가된 피드인지, 크롤링인지 공개 자료만으로 단정하지 않는다.
2. **공식·허용 경로가 확인되지 않으면 수집 기능을 만들지 않는다.** WAF 우회, robots/접근통제 우회, 비공개 엔드포인트 탐색, 앱 디컴파일, 트래픽 복호화, 타사 코드·이미지 추출은 범위에서 제외한다.
3. **폴센트의 문제 해결 방식만 벤치마킹한다.** 가격 그래프, 최저가 알림, 공유를 통한 상품 등록처럼 관찰 가능한 사용자 문제와 기능만 참고한다. 주요 코드, 화면 구성, 문구, 아이콘, 이미지, 애니메이션, 데이터 모델을 그대로 복사하지 않는다.
4. **매장 데이터와 공용 Catalog를 섞지 않는다.** 다른 매장의 상품명, 바코드, 별칭, 재고, 소비량, 발주·가격 추적 상태를 공용 조회 결과로 노출하지 않는다.
5. **추천은 명령이 아니다.** 발주 추천은 사용자가 수정·거절할 수 있는 설명 가능한 제안으로 저장하고, 실제 발주 확정 및 재고 변경은 기존 Stockly 흐름을 사용한다.
6. **라이선스가 불명확한 데이터는 저장하지 않는다.** 특히 Open Food Facts처럼 데이터베이스·이미지·API 이용 조건이 서로 다른 출처는 필드별 라이선스 경계를 둔다.[8][9]

---

## 1. 범위와 사용자 흐름

### 1.1 목표 사용자 흐름

```text
바코드 스캔
  → 현재 매장 product_barcodes / products 조회
  → 등록 상품이면 기존 재고 작업으로 이동
  → 미등록이면 제한된 공개 Catalog 또는 외부 후보 조회
  → 후보·출처·신뢰도·규격을 사용자에게 표시
  → 사용자가 확인하거나 직접 입력
  → 매장 상품 생성 및 Catalog 연결
  → 사용자가 허용된 구매 오퍼를 연결
  → 가격 관측·이력·소진 예측을 결합한 발주 제안
  → 사용자가 제휴 링크를 통해 구매하거나 기존 발주 절차 진행
```

### 1.2 MVP에서 하지 않는 것

- 쿠팡 전체 상품의 무제한 색인
- 쿠팡 바코드 역검색을 공개 DB처럼 제공
- 무단 크롤링 또는 접근통제 우회
- 자동 주문·자동 결제
- 사용자 확인 없는 상품·판매 오퍼 자동 확정
- 가격만으로 투자·재판매 수익을 추천
- 다른 매장 상품을 재사용해 신규 상품을 자동 등록

---

## 2. 현재 계획에 반영한 구조 보완

### 2.1 GTIN과 스캔 바코드 분리

`gtin` 하나만 저장하거나 바코드를 단순히 숫자로만 정규화하지 않는다. GTIN-8, GTIN-12/UPC-A, GTIN-13/EAN/JAN, GTIN-14는 모두 유효한 형식이며, 짧은 GTIN을 14자리 표현으로 사용할 때 앞자리 0은 의미 없는 filler일 수 있다.[10]

권장 필드:

```text
raw_barcode           text        스캐너가 반환한 원본
normalized_gtin14     text        14자리 canonical 값
barcode_format        text        EAN_8 / UPC_A / EAN_13 / GTIN_14 등
check_digit_valid     boolean     체크디짓 검증 결과
normalization_method  text        원본→정규화 방식
packaging_level       text        consumer / inner / case / pallet
source                text        manual / external / catalog 등
```

GS1 prefix를 제조국 또는 원산지로 해석하지 않는다. GS1도 prefix는 제품이 제조된 국가를 의미하지 않는다고 안내한다.[11]

### 2.2 Catalog와 매장 상품 분리

- `product_catalog`: 공개·라이선스 검증을 통과한 표준 상품 사실
- `catalog_barcodes`: Catalog에 연결된 바코드와 코드별 근거
- `catalog_source_records`: 외부 관측·사용자 확인·관리자 검토의 근거
- `products`: 매장별 이름, 단위, 최소재고, 재고 연결, 발주 상태
- `product_barcodes`: 현재 매장 상품이 사용하는 보조 바코드

`products.catalog_id`는 연결용으로만 사용한다. Catalog 조회가 다른 매장 `products`를 검색하는 경로가 되면 안 된다.

### 2.3 커머스 상품과 판매 오퍼 분리

가격은 판매처 상품 정체성보다 실제 판매 오퍼에 붙는 값이므로 아래처럼 분리한다.

```text
product_catalog
  └─ commerce_products       판매처 상품/옵션 정체성
       └─ commerce_offers     판매자·배송·재고·판매 조건
            └─ price_history   관측 가격 이력
```

`commerce_offers`에 포함할 후보 필드:

- `commerce_product_id`
- `platform`
- `external_product_id`
- `external_item_id`
- `seller_id` 또는 공개 가능한 판매자 식별자
- `package_quantity`, `package_unit`
- `shipping_type`, `shipping_amount`
- `availability`
- `membership_or_coupon_condition`
- `product_url`, `affiliate_url`
- `match_status`, `match_confidence`
- `source`, `verified_at`, `last_checked_at`

### 2.4 현재 상태와 감사 이벤트 분리

현재 `confirmed_order_items`는 매장·날짜·상품별 현재 확정 상태를 보관한다. 동일 `(store_id, order_date, product_id)`를 하나의 행으로 유지하므로, 수정·취소의 모든 전후 값을 immutable 이력으로 보존하는 용도로는 부족하다.

추가 예정 테이블:

```text
order_confirmation_events
- id
- store_id
- product_id
- order_date
- event_type: confirmed / updated / cancelled
- before_payload
- after_payload
- actor_id
- request_id
- created_at
```

기존 확정 RPC와 `products.order_completed`/`confirmed_order_pending`의 의미를 바꾸지 않고, 감사 이벤트를 별도로 추가한다.

---

# Phase 0 — 정책·데이터 계약 확정

## Task 0.1: 폴센트의 공개 기능과 관찰 가능한 흐름 정리

**목표:** 폴센트가 사용자에게 제공한다고 공개한 기능과 실제 수집 백엔드에 대해 확인된 사실을 분리한다.

### 현재 확인된 공개 자료

- 폴센트의 공식 앱 설명은 쿠팡 가격 변동 추적, 가격 그래프, 최저가·원하는 가격·재입고 알림을 제공한다고 설명한다.[5][6]
- 공식 웹사이트는 쿠팡을 포함한 여러 쇼핑몰과 가격 그래프·최저가 알림을 서비스 핵심 기능으로 소개한다.[4]
- 공개 제품 소개는 쿠팡 앱의 공유 버튼으로 상품을 간편 등록하는 흐름을 설명한다.[7]
- 이 자료들은 사용자 경험과 입력 방식은 보여 주지만, 폴센트의 서버가 어떤 공식 API·피드·수집 계약을 사용하는지 증명하지는 않는다.

### 조사 결과에 기록할 것

| 항목 | 기록 방식 |
| --- | --- |
| 공개 기능 | 앱스토어·웹사이트에 적힌 표현을 요약하고 URL 기록 |
| 상품 등록 입력 | URL, 공유 payload, 상품 ID 등 사용자가 관찰 가능한 값만 기록 |
| 가격 표시 | 현재가, 최저가, 평균가, 그래프 기간, 품절 표시 여부 |
| 갱신 시점 | 앱 화면에서 보이는 관측 시각과 새로고침 후 변화 |
| 구매 이동 | 링크가 쿠팡 앱·웹·제휴 링크 중 어디로 이동하는지 |
| 확인 수준 | `공개 확인`, `사용자 관찰`, `추정`, `확인 불가`로 구분 |
| 법적 상태 | 공식 허가 근거가 있는지, 확인 전인지 기록 |

## Task 0.2: 폴센트 블랙박스 벤치마크

**목표:** 코드를 보지 않고 사용자 관점의 데이터 흐름만 관찰해 Stockly의 독립적인 요구사항을 만든다.

### 테스트 대상 상품군

공식 쿠팡 앱과 폴센트의 정상 사용자 흐름에서 다음 유형을 각각 1~2개씩 사용한다.

1. 단품 상품
2. 동일 상품의 묶음 상품
3. 옵션·용량이 여러 개인 상품
4. 로켓배송 또는 로켓프레시 상품
5. 품절 또는 재입고가 발생하는 상품
6. 가격·쿠폰·멤버십 조건이 달라지는 상품

### 관찰 절차

1. 폴센트 공식 앱을 설치하고 테스트 계정을 사용한다.
2. 쿠팡 앱에서 상품 상세 화면의 공유 기능으로 폴센트에 등록한다.
3. 폴센트가 표시하는 상품명·옵션·규격·이미지·가격·배송 조건을 기록한다.
4. 동일 상품의 쿠팡 표시값과 폴센트 표시값을 같은 시각에 비교한다.
5. 정해진 간격으로 새로고침해 가격 그래프의 관측 지연과 가격 기준을 기록한다.
6. 폴센트의 구매 버튼이 어떤 링크로 이동하는지만 확인한다.
7. 결과를 `관찰 사실`과 `수집 방식에 대한 추정`으로 분리한다.

### 하지 않을 것

- 폴센트 앱 디컴파일 또는 바이너리 분석
- 폴센트의 private API·앱 내부 endpoint 탐색
- 쿠팡 WAF·robots·접근제어 우회
- 타사 트래픽 복호화·인증서 우회
- 폴센트의 코드, 화면 캡처, 아이콘, 문구, 디자인 토큰, 이미지 복사
- 관찰 결과를 폴센트의 실제 구현 방식이라고 단정

### 산출물

- `docs/research/polscent-benchmark.md` — 관찰 사실·스크린 흐름·기능 요구사항
- `docs/research/polscent-data-method-evidence.md` — 공식 근거와 미확인 가설
- 자체 화면 설계 문서 — 폴센트 화면을 복제하지 않고 Stockly의 재고 맥락에 맞춘 정보 구조

## Task 0.3: 쿠팡 데이터 경로의 공식성 확인

**목표:** 쿠팡의 공식 API/파트너 기능이 Stockly가 필요한 검색·가격·재고·제휴 링크를 실제로 허용하는지 문서와 계정 테스트로 확정한다.

### 공개 자료 1차 확인 결과 — 2026-08-25

| 확인 항목 | 공개 자료 기준 결과 | 판정 |
| --- | --- | --- |
| Partners API 상품 검색 | Partners 공식 포털은 수백만 개 상품을 광고할 수 있고 상품을 골라 광고를 만들 수 있다고 설명하지만, 공개 페이지에서 Partners 계정용 상품검색 API endpoint·권한은 확인되지 않음.[3] | **미확인** |
| GTIN/EAN/UPC 검색 | 공식 API 문서의 공개 endpoint 목록에서 GTIN/EAN/UPC를 검색 키로 사용하는 소비자용 검색 endpoint는 확인되지 않음. GTIN은 2026년 판매자 상품 등록 요건·식별자 문맥으로 노출됨.[14] | **미확인** |
| 현재 가격·옵션 가격 | 공식 API 목록에는 판매자 `vendorItemId` 단위의 가격·수량·상태 조회 endpoint가 존재함. 다만 이는 WING 판매자 상품 관리 범위이며 일반 쿠팡 상품 카탈로그 검색 API라는 근거는 아님.[14] | **판매자 상품에 한해 가능성 확인** |
| 배송비·품절·판매자 정보 | 공개 endpoint 목록에서 판매자 상품·주문·물류 관련 API는 확인되지만, 일반 구매자 관점의 최종 배송비·회원 조건·판매자 비교 응답은 확인되지 않음.[14] | **일부만 확인** |
| 서버 저장·캐시 | 공개 개발자 문서에서 가격·상품정보의 장기 저장, 캐시 TTL, 과거 이력 재배포 허용 범위는 확인되지 않음. | **확인 불가** |
| 반복 관측·가격 그래프 | 공식 rate limit 공지는 호출 빈도를 규정하지만, 이것이 가격을 반복 관측해 이력·그래프로 저장할 수 있다는 허가를 의미하지는 않음.[17] | **확인 불가** |
| 쿠폰·회원가 관계 | 공식 공개 API 목록에 프로모션·쿠폰 API는 있으나, 일반 구매자의 쿠폰·와우 회원가를 포함한 all-in 가격을 반환한다는 설명은 확인되지 않음.[14] | **확인 불가** |
| 딥링크·제휴 표시 | Partners 포털은 광고 클릭 후 구매가 발생하면 수익이 지급되는 제휴 구조를 설명하지만, 공개 페이지에서 딥링크 endpoint와 정확한 고지 문구·위치는 확인되지 않음.[3] | **제휴 구조만 확인** |

현재 공개 문서상 Open API는 WING 판매자 계정이 필요하고, 일반 회원·사업자 인증이 되지 않은 계정은 API Key 발급 대상이 아니라고 안내한다.[13][16] 따라서 Stockly가 쿠팡에서 물건을 구매하는 매장용 서비스라면, 판매자 Open API를 소비자용 상품·가격 DB로 사용할 수 있다고 전제하면 안 된다.

**현재 결론:** 공개 자료만으로는 `Partners API로 GTIN 기반 일반 상품 검색 → 옵션·배송·회원가 포함 가격 조회 → 반복 저장`이라는 전체 흐름을 확인하지 못했다. 이 흐름을 구현하려면 Partners 계정 내부 문서 확인 또는 쿠팡 공식 지원 채널의 서면 답변이 필요하다.

쿠팡의 공개 Open API 문서는 WING 판매자 계정과 상품 등록·조회·수정 흐름을 중심으로 설명하며, Product API Workflow와 상품 등록 가이드에도 판매자 상품 생성·조회 및 상품별 수량/가격/상태 조회가 나열되어 있다.[1][2][15] 이것만으로 쿠팡 전체 상품 가격 이력이나 제휴용 GTIN 검색이 가능하다고 가정하지 않는다.

### 확인할 계약 항목

| 질문 | 통과 기준 |
| --- | --- |
| 상품 검색 | 키워드·상품 ID·GTIN 중 어떤 검색이 허용되는가 |
| 대상 범위 | 전체 공개 상품인지, 특정 판매자 상품인지 |
| 옵션 식별 | 상품·아이템·판매 오퍼 ID를 구분할 수 있는가 |
| 현재 가격 | 기본가·할인가·쿠폰가·회원가 중 무엇을 반환하는가 |
| 배송 비용 | 배송비와 필수 비용을 안정적으로 알 수 있는가 |
| 재고/품절 | availability와 관측 시각을 반환하는가 |
| 가격 이력 | 과거 가격을 API가 제공하는가, 아니면 Stockly가 허용 범위에서 관측해야 하는가 |
| 저장/캐시 | 가격·이미지·제목·URL을 얼마나 오래 저장할 수 있는가 |
| 호출 제한 | rate limit, 일일 한도, backoff 요구사항 |
| 제휴 링크 | 딥링크 생성 및 앱/웹 이동 방식 |
| 표시 의무 | 제휴 고지, 가격 기준, 관측 시각, 면책 문구 |
| 계정 자격 | Partners 계정만으로 가능한지, Seller/WING 계정이 필요한지 |

### 공식 확인 절차

1. 쿠팡 파트너스 공식 포털에서 현재 API·딥링크·상품정보 안내를 확인한다.[3]
2. 공식 개발자 문서에서 실제 endpoint와 응답 필드를 확인한다.[1][2]
3. Stockly용 테스트 계정으로 최소 1개 상품 검색·가격·링크 생성 요청을 실행한다.
4. 계정 발급이나 약관 동의가 필요하면 사용자에게 로그인/승인을 요청한다. 자격증명은 에이전트가 추측하거나 저장하지 않는다.
5. 문서에 없는 가격 이력·캐시·재배포 조건은 쿠팡 지원 채널에 서면으로 질의한다.
6. 답변·약관·API 응답을 `docs/research/coupang-data-contract.md`에 보존한다.

### 쿠팡 문의 초안

```text
Stockly라는 매장 재고관리 서비스에서 사용자가 직접 확인한 상품을
쿠팡 구매 링크와 연결하려고 합니다.

1. Partners API로 상품 검색 및 상품/옵션 ID 조회가 가능한가요?
2. GTIN/EAN/UPC로 상품을 조회할 수 있나요?
3. 현재가·할인가·쿠폰가·배송비·품절 상태를 어떤 필드로 제공하나요?
4. 가격/상품명/이미지/재고 데이터를 Stockly 서버에 캐시·이력 저장할 수 있는 기간은 얼마인가요?
5. 과거 가격 그래프를 만들기 위한 주기적 관측이 허용되나요?
6. 허용되는 공식 경로가 아니라면, URL을 사용자가 직접 연결하고 가격 표시를 생략하는
   대체 UX를 사용해도 되나요?
7. 제휴 링크와 가격 표시 시 필요한 고지 문구·위치는 무엇인가요?
```

### 의사결정 규칙

- 공식 문서와 서면 답변으로 허용 범위가 확인되면 해당 필드만 사용한다.
- 검색은 가능하지만 가격 이력 저장이 허용되지 않으면 현재가·링크만 제공하고 역사 그래프는 만들지 않는다.
- 상품 링크·제휴만 허용되면 사용자가 직접 오퍼를 연결하는 MVP로 축소한다.
- 공식 경로가 확인되지 않으면 쿠팡 자동 수집을 구현하지 않는다.

## Task 0.4: 외부 UPC/EAN 데이터 제공자 선정

**목표:** 바코드 식별 후보를 제공할 최초 외부 출처와 상업적 이용 조건을 확정한다.

### 후보 평가 대상

- Open Food Facts: API·데이터베이스·이미지 라이선스를 별도로 검토한다. 공식 안내는 ODbL, attribution, share-alike, custom User-Agent, rate limit을 명시한다.[8][9]
- GS1 Verified by GS1: GTIN 검증·표준 데이터 사용 가능 범위와 요금/자격을 확인한다.[12]
- 상업용 UPC/EAN 제공자: 한국 식품·생활용품 coverage, 상업 이용, 이미지 사용, SLA, 호출 한도, 삭제 요청을 계약서로 확인한다.

### 평가표

| 평가 항목 | 질문 |
| --- | --- |
| 한국 상품 coverage | 한국 식품·생활용품 바코드가 충분한가 |
| 정확도 | GTIN·브랜드·규격·이미지의 필드별 정확도 |
| 상업 이용 | Stockly 유료 서비스·모바일 앱에서 사용 가능한가 |
| 재배포 | 결과를 공용 Catalog에 저장·제공할 수 있는가 |
| Share-alike | 다른 데이터와 결합했을 때 공개 의무가 생기는가 |
| 이미지 | 이미지 URL·캐시·앱 표시 권리가 있는가 |
| 호출 조건 | User-Agent, rate limit, 캐시 TTL, attribution |
| 장애 대응 | timeout·빈 결과·오류 시 수동 등록으로 전환 가능한가 |
| 비용 | 무료 한도, 유료 단가, 예상 월 비용 |
| 감사성 | source record와 버전/관측 시각을 남길 수 있는가 |

### 선택 규칙

- 첫 provider는 1개만 운영하고, fallback은 별도 라이선스가 확인된 경우에만 추가한다.
- 외부 결과는 처음부터 `candidate`로 저장하고 사용자 확인 전에는 공용 `published` Catalog로 승격하지 않는다.
- 라이선스가 다른 출처의 필드·이미지를 하나의 공용 레코드로 혼합하지 않는다.
- Open Food Facts 파생 데이터를 proprietary Catalog로만 재배포하는 구조는 법률 검토 전에는 채택하지 않는다.

### 산출물

- `docs/research/upc-ean-provider-matrix.md`
- `docs/research/data-license-register.md`
- provider별 API 계약 테스트 목록
- 필드별 `source`, `license`, `attribution_required`, `retention_policy` 결정표

## Task 0.5: Phase 0 Go/No-Go 회의

**통과 조건:** 다음 6개 결정이 문서로 승인되어야 Phase 1 코딩을 시작한다.

1. 쿠팡에서 사용할 공식 데이터 경로와 허용 필드
2. 폴센트 관찰 결과와 확인 불가 영역
3. 최초 UPC/EAN provider와 상업 이용 조건
4. Catalog 공개/tenant-private/review 상태 경계
5. GTIN 정규화 및 packaging level 규칙
6. 가격 데이터 저장·갱신·삭제·고지 정책

**No-Go 조건:** 쿠팡 또는 외부 provider의 허용 범위가 문서화되지 않았거나, 타사 데이터·이미지 재사용 권리가 불명확하면 외부 가격 기능은 보류하고 수동 상품 등록 및 사용자 직접 링크 연결만 진행한다.

---

# Phase 1 — 바코드 기반 상품 등록 MVP

## Task 1.1: GTIN 정규화·체크디짓 helper

**예정 파일:**

- Create: `src/lib/barcode/normalizeGtin.ts`
- Modify: `src/pages/ScanPage.tsx`
- Modify: `src/pages/ProductEditPage.tsx`
- Test: `scripts/mobile-inventory.test.mts` 또는 새 `scripts/barcode-catalog.test.mts`

**핵심 동작:**

- 원본 문자열 보존
- 숫자·길이·형식 검증
- GTIN-8/12/13/14 지원
- 체크디짓 검증
- UPC-A와 GTIN-14 비교 시 leading zero를 안전하게 처리
- 실패한 코드는 외부 lookup으로 보내지 않고 수동 입력으로 전환

**검증:** 정상·오류·앞자리 0·형식 충돌 fixture를 모두 통과시킨다.

## Task 1.2: Catalog 및 바코드 migration

**예정 파일:**

- Create: `supabase/migrations/060_product_catalog.sql`
- Modify: `src/types/supabase.ts`
- 필요 시 Modify: `src/types/domain.ts`

**핵심 테이블:**

- `product_catalog`
- `catalog_barcodes`
- `catalog_source_records`
- 기존 `products.catalog_id`

**보안:**

- 공용 published 데이터와 tenant-private 데이터를 상태로 구분
- 활성 바코드 충돌은 unique 충돌로 덮어쓰지 않고 review queue로 보냄
- `security definer` RPC는 `search_path` 고정 및 권한 확인
- 매장별 products를 Catalog lookup에서 조인하지 않음

## Task 1.3: 현재 매장 우선 조회

**예정 파일:**

- Modify: `src/pages/ScanPage.tsx`
- Create: `src/lib/catalogLookup.ts`
- Modify: `src/services/database/DatabaseService.ts`가 필요한 경우에만 서비스 계약 추가
- Test: `scripts/barcode-catalog.test.mts`

**순서:**

1. 현재 매장의 `product_barcodes` 조회
2. 현재 매장의 기본 `products.barcode` 조회
3. hit이면 기존 재고 작업으로 이동
4. miss일 때만 제한된 `lookup_catalog_by_barcode(barcode)` 호출
5. Catalog 후보가 없으면 기존 `ProductEditPage` 수동 등록으로 이동

**불변 조건:** 기존 native/web scanner 중복 이동 방지, `PENDING_SCAN_STORAGE_KEY`, receipt-check-only 흐름을 깨지 않는다.

## Task 1.4: 사용자 확인·Catalog 연결

**예정 파일:**

- Modify: `src/pages/ProductEditPage.tsx`
- Create: `src/components/CatalogCandidateCard.tsx`
- Create: `src/lib/catalogMatching.ts`
- Modify: `scripts/mobile-inventory.test.mts`

**UI:**

- 후보 상품명·브랜드·규격·출처·신뢰도·검증 시각 표시
- 사용자가 후보 채택·거절·수동 입력 선택
- 사용자 확인값은 `verified_at`, `verification_method=user_confirmed`로 기록
- 외부 결과가 나중에 바뀌어도 확인된 값을 자동 덮어쓰지 않음

---

# Phase 2 — 허용된 커머스 상품 매칭 MVP

## Task 2.1: 판매처·상품·오퍼 migration

**예정 파일:**

- Create: `supabase/migrations/061_commerce_products_offers.sql`
- Modify: `src/types/supabase.ts`

**핵심:** `commerce_products`와 `commerce_offers`를 분리하고, 판매자·옵션·묶음·배송 조건을 오퍼 단위로 기록한다.

## Task 2.2: 사용자 확인 방식의 오퍼 연결

**예정 파일:**

- Create: `supabase/functions/resolve-commerce-offer/index.ts`
- Create: `src/lib/commerceMatching.ts`
- Create: `src/components/CommerceOfferCandidate.tsx`
- Modify: `src/pages/ProductEditPage.tsx` 또는 별도 커머스 연결 화면

**원칙:** 공식 API/피드가 허용하는 경우에만 자동 후보를 만들고, GTIN·브랜드·규격·묶음 수가 모두 맞는 경우에도 기본값은 사용자 확인이다.

## Task 2.3: 제휴 고지·구매 링크

- 링크 클릭과 재고 변경 이벤트를 분리 기록
- 제휴 링크임을 구매 버튼 주변에 명확히 표시
- 관측 시각·가격 기준·결제 시 가격 변동 가능성을 함께 표시
- 자동 주문·결제는 구현하지 않음

---

# Phase 3 — 가격 이력과 알림

## Task 3.1: 가격 관측 계약

**예정 파일:**

- Create: `supabase/migrations/062_price_history.sql`
- Create: `supabase/functions/observe-commerce-prices/index.ts`
- Create: `src/lib/priceObservation.ts`

가격은 실제 가격이 붙는 `commerce_offer_id`에 기록한다.

```text
price_amount
shipping_amount
mandatory_fee_amount
effective_price
currency
availability
observed_at
source
source_license
raw_reference
observation_id
```

관측 실패는 마지막 정상값을 오류 페이지로 덮어쓰지 않는다. 오래된 가격은 화면에서 오래됨을 표시하고 추천에서 제외할 수 있어야 한다.

## Task 3.2: 그래프·알림

- 7/30일 최저·평균·현재가 집계
- 동일 오퍼·동일 조건만 비교
- 쿠폰가·회원가·배송비 포함 여부를 분리 표시
- 사용자가 명시적으로 구독한 상품만 알림
- 중복 알림 방지를 위해 fingerprint와 cooldown 저장

폴센트의 그래프·알림은 문제 정의의 참고로만 사용하며, Stockly는 재고 소진 예정일·리드타임·발주 상태를 함께 보여 주는 독립 화면으로 설계한다.[4][5][6]

---

# Phase 4 — Inventory Intelligence 발주 추천

## Task 4.1: 소비량 추정

**예정 파일:**

- Create: `src/lib/inventoryIntelligence.ts`
- Create: `scripts/inventory-intelligence.test.mts`
- 필요 시 Create: `supabase/migrations/063_reorder_policies.sql`

초기 기본값:

- 사용량 기간: 최근 30일
- 사용량 0 또는 표본 부족: 추천을 보류하고 데이터 부족 표시
- 이상치: 메모·복원·취소 로그를 제외하고 실제 소비로 확정된 로그만 사용
- 리드타임·안전재고·최소 주문 단위: 매장별/상품별 설정, 없으면 기본값과 근거 표시

## Task 4.2: 추천 계산식 고정

```text
target_stock
  = expected_daily_usage × (lead_time_days + review_period_days)
    + safety_stock

available_stock
  = current_stock + confirmed_open_order_qty - reserved_qty

recommended_order
  = ceil_to_package_unit(target_stock - available_stock)
```

결과에는 다음을 함께 표시한다.

- 사용한 재고 시각
- 사용량 산정 기간과 표본 수
- 예상 소진일
- 리드타임·안전재고·최소 주문 단위
- 가격 데이터의 관측 시각과 신뢰도
- 추천에서 가격을 제외한 사유
- 사용자가 수정한 값과 추천 원본 값

가격이 낮다는 이유만으로 결품 위험을 높이지 않는다. 가격은 재고 안전성보다 낮은 우선순위의 보조 신호다.

---

# Phase 5 — 품질·보안·운영

## Task 5.1: RLS 음성 테스트

세 가지 역할로 테스트한다.

1. 다른 매장에 소속된 계정
2. 현재 매장의 일반 직원
3. 미등록 또는 만료된 세션

검증 대상:

- 다른 매장 `products`, `product_barcodes`, inventory, logs 접근 불가
- Catalog RPC가 매장 존재 여부·등록 매장 수·별칭을 반환하지 않음
- `commerce_products`/`price_history`에서 특정 매장의 사용·구매·추적 상태가 노출되지 않음

## Task 5.2: 외부 연동 장애 테스트

- 외부 API timeout
- rate limit
- 빈 후보
- 잘못된 GTIN
- 오래된 가격
- 이미지 접근 실패
- provider 라이선스 철회

모든 경우 기존 수동 등록과 재고 작업은 계속 가능해야 한다.

## Task 5.3: 저작권·독립 구현 점검

각 구현 PR 전에 다음 체크리스트를 확인한다.

- 폴센트 코드·바이너리·private API를 사용하지 않았는가
- 폴센트 스크린샷·아이콘·이미지·문구를 그대로 사용하지 않았는가
- 동일 기능을 Stockly의 재고·발주 맥락에 맞는 독립 컴포넌트로 설계했는가
- 외부 데이터의 source/license/attribution을 필드와 화면에 반영했는가
- 쿠팡 가격은 공식 허용 범위와 관측 시각을 표시하는가
- 사용자 확인과 실제 발주 변경을 분리했는가

---

# 구현 규칙과 검증 방식

## 테스트 순서

코드 변경이 필요한 각 Task는 다음 순서로 진행한다.

1. exact behavior를 검증하는 focused test 작성
2. 수정 전 실패 확인
3. 최소 구현
4. 동일 테스트 통과 확인
5. 관련 전체 테스트·build·lint 실행
6. RLS/RPC 또는 실제 외부 API 변경이면 read-back 및 권한 테스트

## 저장소 기본 검증

```bash
node --experimental-strip-types scripts/mobile-inventory.test.mts
npm run build
npm run lint
git diff --check
```

Catalog/외부 데이터 변경 시 추가 검증:

```bash
npx supabase db lint
npx supabase migration list --linked
```

실제 외부 API는 테스트 계정·최소 상품·rate limit 안에서만 호출한다. 자격증명은 `.env` 또는 서버 secret에만 보관하고 커밋하지 않는다.

## 예상 파일 목록

### Phase 0 조사 문서

- `docs/research/polscent-benchmark.md`
- `docs/research/polscent-data-method-evidence.md`
- `docs/research/coupang-data-contract.md`
- `docs/research/upc-ean-provider-matrix.md`
- `docs/research/data-license-register.md`

### 앱·백엔드

- `src/pages/ScanPage.tsx`
- `src/pages/ProductEditPage.tsx`
- `src/lib/barcode/normalizeGtin.ts`
- `src/lib/catalogLookup.ts`
- `src/lib/catalogMatching.ts`
- `src/lib/commerceMatching.ts`
- `src/lib/priceObservation.ts`
- `src/lib/inventoryIntelligence.ts`
- `supabase/migrations/060_product_catalog.sql` 이후 번호 순차 migration
- `supabase/functions/lookup-catalog-by-barcode/index.ts`
- `supabase/functions/resolve-commerce-offer/index.ts`
- `supabase/functions/observe-commerce-prices/index.ts`
- `src/types/supabase.ts`
- `src/types/domain.ts`
- `scripts/barcode-catalog.test.mts`
- `scripts/inventory-intelligence.test.mts`

---

# 현재 결정이 필요한 질문

1. 쿠팡 Partners/Open API 계정 또는 공식 제휴 데이터 경로를 사용할 수 있는가?
2. 가격 이력 저장이 허용되지 않을 경우, Stockly MVP를 `사용자 직접 오퍼 연결 + 현재 링크`로 축소할 것인가?
3. Open Food Facts를 후보 표시용으로만 사용할지, ODbL 조건을 수용하고 파생 데이터 공개 정책까지 설계할 것인가?
4. 첫 외부 UPC/EAN provider의 월 호출 예산과 한국 상품 coverage 최소 기준은 무엇인가?
5. 매장별 추천을 위한 리드타임·안전재고·최소 주문 단위를 언제 입력받을 것인가?

**권장 기본값:** Phase 0에서는 외부 가격 수집을 구현하지 않고, `폴센트 공개 기능·공식 쿠팡 계약·UPC/EAN 라이선스`를 조사 문서로 확정한 뒤, Phase 1의 매장 격리·GTIN 검증·사용자 확인 등록부터 구현한다.

## Sources

[1] https://developers.coupangcorp.com/hc/en-us/articles/360033642034-Product-API-Workflow
[2] https://developers-v1.coupangcorp.com/hc/en-us/articles/360033917473-Coupang-OPEN-API
[3] https://partners.coupang.com
[4] https://fallcent.com
[5] https://apps.apple.com/kr/app/id1638569789
[6] https://play.google.com/store/apps/details?id=com.deaguowl.fallcent&hl=ko
[7] https://disquiet.io/products/%ED%8F%B4%EC%84%BC%ED%8A%B8
[8] https://support.openfoodfacts.org/help/en-gb/12-api-data-reuse/94-are-there-conditions-to-use-the-api
[9] https://openfoodfacts.github.io/documentation/docs/Product-Opener/api/tutorials/license-be-on-the-legal-side
[10] https://support.gs1.org/support/solutions/articles/43000734124-what-is-the-difference-between-a-gs1-gtin-a-barcode-an-ean-and-a-upc-
[11] https://www.gs1.org/standards/id-keys/company-prefix
[12] https://www.gs1.org/services/verified-by-gs1
[13] https://developers.coupang.com/ko/getting-started/coupang-open-api?ref=legacy
[14] https://developers.coupang.com/ko/api
[15] https://developers.coupangcorp.com/hc/en-us/articles/360034889893-OPEN-API-Product-Listing-Guide
[16] https://developers.coupangcorp.com/hc/en-us/articles/20288952179993
[17] https://developers.coupang.com/ko/notices/optimization-and-adjustment-of-open-api-rate-limiteffective-march-17th2026
