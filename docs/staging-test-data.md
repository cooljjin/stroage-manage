# Staging 테스트 데이터

staging(`nchvyxhyfatgwpvilbng`)에서만 사용한다. production 데이터·사용자·Storage 객체를 복사하지 않는다.

## 최초 준비

1. staging에서 전용 계정으로 일반 가입한다.
2. 앱의 `새 매장 만들기` 흐름으로 이름이 정확히 `테스트 매장`인 매장을 만든다. SQL로 Auth/profile 권한을 우회하지 않는다.
3. staging project ref를 다시 확인한 뒤 seed를 실행한다.

```bash
npx supabase link --project-ref nchvyxhyfatgwpvilbng
npm run seed:staging
```

`seed:staging`은 Supabase CLI의 현재 linked project가 정확히 `nchvyxhyfatgwpvilbng`인지 확인한 뒤에만 seed와 contract SQL을 순서대로 실행한다. production 또는 다른 프로젝트가 연결되어 있으면 DB query 전에 중단한다.

seed는 다음의 작은 fixture만 idempotent하게 만든다.

| 용도 | 이름 | 바코드/GTIN |
| --- | --- | --- |
| 이미 등록된 스캔 | `테스트 등록 바코드 상품` | `8801234567893` |
| 후보 조회 | `테스트 후보 상품` | `00036000291452` |

두 번째 값은 `테스트 매장`의 `products`에는 만들지 않는다. `product_catalog` 후보이므로 candidate 확인 뒤에만 앱이 새 상품을 만든다.

## 정리

수동 테스트와 삭제/초기화는 staging의 `테스트 매장`에서만 수행한다. fixture 이름은 모두 `테스트`로 시작해야 한다. 필요하면 `테스트`로 시작하는 fixture와 candidate catalog row를 staging에서 삭제한 뒤 seed를 다시 실행한다.
