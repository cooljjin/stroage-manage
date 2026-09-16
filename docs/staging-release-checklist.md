# Staging release checklist

> 대상: `nchvyxhyfatgwpvilbng` / `App` / `com.jinkim.stockly` / `테스트 매장`
>
> production 배포는 이 체크리스트의 모든 필수 항목이 통과하고 사용자가 명시적으로 승인하기 전까지 금지한다.

## Backend parity

- [ ] `npx supabase migration list --linked`에서 local/remote가 `087`까지 일치한다.
- [ ] `npx supabase functions list`에서 `product-lookup`, `product-confirm`, `manage-account-deletion`, `recipe-import`, `recipe-import-cleanup`, `account-purge-scheduler`가 배포되어 있다.
- [ ] staging `PRODUCT_LOOKUP_TOKEN_SECRET`은 production과 독립적이다.
- [ ] Auth Redirect URL에 `com.jinkim.stockly://auth/callback`만 staging native callback으로 등록되어 있다.
- [ ] 전용 staging 계정의 선택 매장은 `테스트 매장`이다.

## Automated evidence

```bash
node --test \
  tests/ios-channel-prepare.test.mjs \
  tests/product-lookup-service.test.mjs \
  tests/product-lookup-handler.test.mjs \
  tests/product-confirm-handler.test.mjs \
  tests/product-candidate-ui.test.mjs
node --experimental-loader ./tests/scan-page-loader.mjs --test tests/scan-page-flow.test.mjs
npm run lint
npm run ios:prepare:staging
```

- [ ] 모든 명령이 성공했다.
- [ ] staging bundle의 `VITE_DEPLOYMENT_ENV`는 `staging`이다.
- [ ] channel guard 출력의 Bundle ID는 `com.jinkim.stockly`다.

## Browser smoke check

- [ ] 등록 바코드 `8801234567893`을 스캔/입력하면 재고 작업으로 이동한다.
- [ ] 등록되지 않은 `00036000291452`에서 후보가 표시된다.
- [ ] 후보 수락 뒤 테스트 상품이 정확히 하나 생성된다.
- [ ] 재확인해도 중복 상품이 생성되지 않는다.
- [ ] 결과 없는 바코드에서는 수동 등록이 계속 가능하다.

## iPhone release gate

`npm run ios:prepare:staging` 성공 뒤 Xcode `App` scheme만 archive/install한다.

- [ ] staging 전용 계정으로 로그인했다.
- [ ] 카메라 권한을 허용하고 실제 EAN-13/UPC를 스캔했다.
- [ ] 후보를 수락/저장했다.
- [ ] 같은 코드를 다시 스캔하면 등록 대신 기존 재고 작업으로 이동했다.
- [ ] 생성된 모든 record가 `테스트 매장`에만 존재함을 확인했다.

실기기 검증은 scanner/native bridge, iOS packaging, Auth redirect, barcode lookup/confirmation 변경마다 필수다.

## Production handoff

staging 통과는 production 변경이 아니다. production 명령 직전에 아래 세 값과 명시적 사용자 승인을 다시 확인한다.

- project ref: `pcvpkndyqkljgbrvssza`
- Xcode scheme: `Stockly Staff`
- Bundle ID: `com.jinkim.storeinventory.poc`
