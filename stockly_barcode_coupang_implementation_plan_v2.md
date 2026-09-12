# Stockly 바코드 · 상품 DB · 쿠팡 가격추적 구현 계획

## 1. 목표

Stockly의 품목 등록과 발주 흐름을 다음과 같이 발전시키는 것을 목표로 한다.

> **바코드 스캔 → 상품 자동 식별 → 상품명/브랜드/규격/이미지 자동 입력 → 재고 등록 → 쿠팡 상품 연결 → 가격 이력 추적 → 발주 타이밍 추천 → 쿠팡 구매**

핵심은 단순한 바코드 스캐너나 가격 추적 기능이 아니라, **재고 데이터와 구매 데이터를 연결하는 것**이다.

---

## 2. 핵심 개념

### 바코드는 상품 정보가 아니라 식별자

UPC / EAN / GTIN 바코드는 보통 상품명, 브랜드, 이미지 같은 정보를 직접 담고 있지 않다.

예:

```text
8801234567890
```

Stockly에서는 이 값을 **상품을 찾기 위한 검색 키**로 사용한다.

```text
바코드
↓
상품 DB 조회
↓
상품명 / 브랜드 / 규격 / 이미지
```

---

## 3. 전체 데이터 구조

장기적으로는 다음 구조를 기준으로 잡는다.

```text
Barcode → Canonical Product → Commerce Offer → Price History → Inventory
```

- **Barcode**: 스캔된 UPC/EAN/GTIN
- **Canonical Product**: 실제 상품 자체
- **Commerce Offer**: 쿠팡 등 판매처의 판매 상품
- **Price History**: 판매 상품의 가격 변화 기록
- **Inventory**: 각 매장에서 관리하는 실제 재고

---

## 4. Product Catalog 설계

매장별 재고와 상품 자체의 정보를 분리한다.

### product_catalog

```text
id
gtin
barcode_type

canonical_name
brand
manufacturer

size
unit

image_url

source
confidence
verified_at

created_at
updated_at
```

예:

```text
gtin: 8801234567890
canonical_name: 서울우유 나100% 1L
brand: 서울우유
size: 1000
unit: ml
source: open_food_facts
```

### products

기존 Stockly의 매장별 품목은 Product Catalog를 참조한다.

```text
id
store_id
catalog_id

custom_name

current_quantity
minimum_quantity

storage_location
order_url
...
```

즉 역할은 다음과 같이 나뉜다.

```text
product_catalog
= 이 상품이 무엇인가?

products
= 우리 매장에서 이 상품을 어떻게 관리하는가?
```

---

## 5. 바코드 자동등록 흐름

### 목표 UX

```text
[바코드 스캔]

삑!

서울우유 나100% 1L
서울우유 · 1000ml

[상품 이미지]

[재고에 추가]
```

사용자가 상품명, 브랜드, 규격, 이미지를 직접 입력하지 않아도 되도록 한다.

---

## 6. 바코드 조회 파이프라인

### 1단계 — Stockly 자체 Catalog

```text
Barcode
↓
product_catalog 조회
```

이미 등록된 바코드라면 즉시 상품 정보를 반환한다.

가장 빠르고 비용이 들지 않는 경로다.

### 2단계 — Open Food Facts

Stockly DB에 없으면 외부 상품 DB를 조회한다.

카페나 식자재 품목이 많다면 식품 중심 DB인 Open Food Facts를 우선 사용할 수 있다.

주요 조회 정보:

- 상품명
- 브랜드
- 규격
- 카테고리
- 이미지

### 3단계 — UPC / EAN / GTIN 외부 DB

Open Food Facts에서 결과가 없으면 UPCitemdb 등 범용 상품 DB를 추가 조회한다.

### 4단계 — 사용자 확인

외부 DB에서 찾은 상품을 바로 확정하지 않는다.

```text
이 상품이 맞나요?

[상품 이미지]

서울우유 나100% 1L
서울우유 · 1000ml

[맞아요]
[직접 수정]
```

사용자 확인 후 `product_catalog`에 저장한다.

### 5단계 — 자체 DB 축적

같은 바코드를 이후 다시 스캔하면:

```text
Barcode
↓
Stockly Catalog HIT
↓
즉시 상품 반환
```

사용자가 늘어날수록 외부 API 의존도가 줄어들고 Stockly 자체 상품 DB의 커버리지가 증가한다.

---

## 7. 상품 이미지 자동등록

상품 링크를 이용할 경우 대표 이미지는 다음 순서로 탐색할 수 있다.

```text
JSON-LD Product
↓
og:image
↓
일반 이미지 후보
```

추천 흐름:

```text
상품 이미지를 찾았습니다.

[이미지]

이 이미지를 사용할까요?

[사용하기]
[다른 이미지 선택]
```

가능하면 외부 이미지를 무조건 Stockly Storage에 복사하지 않고 URL 참조를 우선 고려한다.

다만 장기적으로는 다음 문제를 고려해야 한다.

- 이미지 URL 변경
- Hotlink 차단
- 쇼핑몰 약관
- 이미지 저작권
- 이미지 캐싱 허용 범위

---

## 8. 쿠팡 중심 상품 연결

Stockly의 수익 모델이 쿠팡 구매와 연결된다면 쿠팡은 단순 바코드 DB라기보다 **구매 가능한 판매 상품 데이터**로 다루는 것이 좋다.

기본 구조:

```text
GTIN
↓
Canonical Product
↓
Coupang Offer
```

쿠팡 상품 ID를 Stockly 상품 자체의 기본 식별자로 사용하지 않는다.

하나의 실제 상품이 쿠팡에서는 여러 판매자, 여러 옵션, 여러 묶음상품으로 존재할 수 있기 때문이다.

---

## 9. Commerce Product 구조

### commerce_products

```text
id
catalog_id

platform

platform_product_id
vendor_item_id

product_url
image_url

current_price
last_checked_at

created_at
updated_at
```

예:

```text
catalog_id: abc123
platform: coupang
platform_product_id: 123456789
vendor_item_id: 987654321
current_price: 14900
```

관계:

```text
서울우유 1L
(Product Catalog)

├─ 쿠팡 판매상품 A
├─ 쿠팡 판매상품 B
└─ 쿠팡 판매상품 C
```

즉 **Product와 Offer를 분리**한다.

---

## 10. 쿠팡 상품 매칭

가능한 경우:

```text
GTIN
↓
쿠팡 상품 매칭
```

GTIN으로 직접 찾기 어렵다면:

```text
브랜드
+
상품명
+
규격
↓
쿠팡 상품 후보 검색
```

후보가 여러 개면 사용자가 올바른 상품을 확인한다.

한 번 확인된 매칭은 Stockly DB에 저장한다.

---

## 11. 쿠팡 제휴 구매 흐름

가격 추적보다 먼저 기본 구매 흐름을 검증한다.

예:

```text
서울우유 나100% 1L

현재 재고
2개

⚠ 부족재고

[쿠팡에서 구매]
```

이 단계에서 확인할 지표:

- 쿠팡 구매 버튼 클릭률
- 부족재고 → 구매 전환율
- 쿠팡 상품 매칭 정확도
- 실제 사용자 체감 가치

---

## 12. 가격 이력 DB

쿠팡 가격은 계속 변하기 때문에 현재 가격만 저장해서는 가격 판단 기능을 만들기 어렵다.

따라서 가격 이력 테이블을 별도로 둔다.

### price_history

```text
id
commerce_product_id

price
discount_price

checked_at
```

예:

```text
08/01  17,900원
08/05  16,900원
08/10  14,900원
08/15  17,200원
08/22  14,500원
```

이 데이터가 쌓이면 다음을 계산할 수 있다.

- 현재가
- 7일 최저
- 30일 최저
- 7일 평균
- 30일 평균
- 역대 최저
- 평균 대비 현재가
- 가격 변동률

---

## 13. 가격 알림

기본적인 가격 추적 기능도 구현할 수 있다.

### 목표 가격 알림

```text
서울우유 1L가
15,000원 이하가 되면 알려주세요.
```

### 상대 가격 알림

```text
최근 30일 평균보다
15% 저렴해졌습니다.
```

### 최저가 알림

```text
최근 30일 최저가에 가까워졌습니다.
```

여기까지는 일반적인 Price Tracking 기능이다.

---

## 14. 폴센트와의 차별화 및 법적 고려

가격을 기록하고 가격이 내려갔을 때 알려주는 **기능 아이디어 자체**와 다른 서비스의 구체적인 구현을 복제하는 것은 구분해야 한다.

피해야 할 것:

- 폴센트 코드 복제
- 폴센트 UI를 그대로 복제
- 폴센트 고유 문구/브랜딩 모방
- 폴센트가 축적한 가격 데이터 이용

Stockly는 자체 데이터를 수집하고 자체 UI와 알고리즘을 사용한다.

출시 전에는 관련 등록 특허 여부를 별도로 검토하는 것이 좋다.

실제 구현에서 더 중요한 부분은 **쿠팡 API / 파트너스 정책 / 데이터 이용약관**이다.

특히 확인해야 할 항목:

- 가격 데이터 저장 허용 여부
- 가격 이력 장기 보관 가능 여부
- 가격 표시 규칙
- API 호출 및 캐싱 제한
- 상품 이미지 사용 조건
- 상품정보 저장 조건
- 제휴 링크 생성 및 표시 규칙
- 자동화된 가격 수집 허용 범위

가능하면 무단 크롤링보다 공식 API 또는 허용된 데이터 경로를 우선한다.

---

## 15. Stockly의 핵심 차별점 — Inventory Intelligence

Stockly는 단순 최저가 알림 앱이 아니라 이미 **재고 데이터**를 가지고 있다는 점이 가장 큰 강점이다.

결합할 데이터:

```text
현재 재고
+
평균 소비속도
+
예상 소진일
+
안전재고
+
입고 소요일
+
현재 쿠팡 가격
+
가격 이력
```

이를 통해 단순히:

> 가격이 내려갔습니다.

가 아니라:

> 지금 발주하기 좋은 시점입니다.

를 판단하게 한다.

---

## 16. 발주 판단 예시

### 재고 충분 + 가격 비쌈

```text
현재 재고가 충분합니다.

현재 가격은
30일 평균보다 8% 비쌉니다.

급하지 않다면 기다려보세요.
```

### 재고 충분 + 가격 매우 저렴

```text
현재 재고는 충분하지만
현재 가격이 30일 평균보다 18% 저렴합니다.

미리 발주하기 좋은 가격입니다.
```

### 재고 부족 + 가격 적정

```text
약 2일 후 재고가 소진될 것으로 예상됩니다.

현재 가격은 평균 수준입니다.

지금 발주하는 것을 추천합니다.
```

### 재고 부족 + 가격 매우 비쌈

```text
재고가 부족하지만
현재 가격이 평소보다 높습니다.

대체상품을 확인하거나
필요한 수량만 우선 발주하는 것을 추천합니다.
```

---

## 17. 최종 사용자 경험

장기적으로 다음 흐름을 목표로 한다.

```text
바코드 스캔
↓
상품 자동 인식
↓
재고 등록
↓
소비량 축적
↓
예상 소진일 계산
↓
부족재고 감지
↓
쿠팡 상품 연결
↓
현재가격 + 가격이력 분석
↓
발주 타이밍 추천
↓
쿠팡에서 구매
```

수익 구조도 자연스럽게 연결된다.

```text
재고 관리
↓
부족 품목 발견
↓
구매 필요성 발생
↓
좋은 발주 시점 추천
↓
쿠팡 구매
↓
제휴 수익
```

---

# 18. 구현 순서

## V1 — Product Catalog / 바코드 자동등록

### 1. Product Catalog 스키마 확정

- `product_catalog` 생성
- GTIN / EAN / UPC 저장 방식 결정
- 기존 `products`와 분리
- 중복 상품 처리 정책 정의

### 2. Stockly 자체 DB 조회

```text
바코드 스캔
↓
product_catalog
↓
HIT → 자동입력
```

### 3. 외부 UPC/EAN DB 연결

```text
Stockly MISS
↓
Open Food Facts
↓
UPC/EAN DB
```

### 4. 사용자 확인 및 Catalog 저장

외부 결과를 사용자에게 보여주고 확인된 상품만 Catalog에 저장한다.

### 5. 실제 품목 정확도 테스트

실제 카페/매장 품목 약 100~300개를 테스트한다.

측정:

- Stockly Catalog HIT율
- Open Food Facts HIT율
- 외부 DB 추가 HIT율
- 이미지 존재율
- 잘못된 상품 매칭률

---

## V2 — 쿠팡 상품 연결

### 6. Commerce Product 구조 추가

`commerce_products` 테이블 생성.

### 7. Stockly 상품 ↔ 쿠팡 상품 매칭

GTIN 또는 `브랜드 + 상품명 + 규격`으로 후보를 찾고 사용자가 확인한다.

### 8. 쿠팡 제휴 구매 흐름 출시

```text
부족재고
↓
쿠팡 구매
```

실제 전환율을 먼저 확인한다.

---

## V3 — 가격 추적

### 9. Price History 구조 추가

`price_history` 테이블 생성.

### 10. 가격 통계 계산

- 현재가
- 7일 평균
- 30일 평균
- 7일 최저
- 30일 최저
- 역대 최저
- 평균 대비 현재가

### 11. 가격 알림

- 목표가격 알림
- 평균 대비 하락 알림
- 최근 최저가 알림

---

## V4 — Inventory Intelligence

### 12. 재고와 가격 데이터 결합

```text
재고량
소비속도
예상 소진일
안전재고
현재가격
가격이력
```

최종적으로 Stockly가 **무엇을 언제 사야 하는지** 추천하도록 한다.

---

# 19. 지금 당장 우선할 작업

```text
① product_catalog 설계
② 바코드 → Stockly Catalog 조회
③ Open Food Facts / UPC DB 연결
④ 사용자 확인 및 자체 DB 축적
⑤ 실제 한국 카페 품목으로 정확도 측정
⑥ 쿠팡 상품 연결
⑦ 구매 전환 검증
⑧ 가격 이력 축적
⑨ 가격 알림
⑩ Inventory Intelligence
```

핵심 기반은 다음과 같다.

> **Barcode → Canonical Product → Commerce Offer → Price History → Inventory**

이 구조를 먼저 안정적으로 잡으면 이후 쿠팡뿐 아니라 네이버 쇼핑, 식자재몰, B2B 공급사 등으로 확장하기도 쉽다.
