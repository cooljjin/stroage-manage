# Stockly 환경 계약

Stockly는 세 환경만 사용한다.

| 환경 | Supabase 프로젝트 | iOS scheme | Bundle ID | 데이터 정책 |
| --- | --- | --- | --- | --- |
| local | 로컬 Supabase | 해당 없음 | 해당 없음 | 폐기 가능한 자동화 테스트 |
| staging | `nchvyxhyfatgwpvilbng` (`stockly-staging`) | `App` | `com.jinkim.stockly` | 테스트 전용 |
| production | `pcvpkndyqkljgbrvssza` | `Stockly Staff` | `com.jinkim.storeinventory.poc` | 운영 데이터 |

## 불변 조건

- staging 배포는 production URL 또는 `pcvpkndyqkljgbrvssza`를 사용하지 않는다.
- 직원 TestFlight archive는 staging URL 또는 staging project ref를 사용하지 않는다.
- production 변경은 테스트 검증 수단이 아니며, staging 증거와 명시적 승인 뒤에만 수행한다.
- 각 cloud 프로젝트는 Edge Function secret과 Auth Redirect URL을 독립적으로 관리한다. secret, anon key, service-role key는 저장소에 기록하지 않는다.
- Vite의 `VITE_*` 값은 빌드에 포함된다. 런타임 환경 전환 UI를 추가하지 않는다.
- root `capacitor.config.json`은 직원 앱의 signing source of truth가 아니다. 직원 앱의 Bundle ID와 plist는 Xcode `Stockly Staff` scheme/target 설정이 결정한다.

## iOS 빌드

`.env.example`을 `.env.staging` 또는 `.env.production`으로 복사해 각각의 값을 비밀 저장소에서 채운다. 두 파일은 Git에 추가하지 않는다.

```bash
npm run ios:prepare:staging
# Xcode: App / com.jinkim.stockly archive

npm run ios:prepare:production
# Xcode: Stockly Staff / com.jinkim.storeinventory.poc archive
```

`ios:prepare`는 이전 호환성용이다. TestFlight에는 사용하지 않는다.

## Supabase 대상 확인

`npx supabase link --project-ref <target-ref>` 뒤에는 쓰기 전에 반드시 아래 명령으로 대상과 migration 상태를 읽어 확인한다.

```bash
npx supabase migration list --linked
npx supabase functions list
```

staging은 `테스트 매장`과 전용 테스트 계정만 사용한다. production 데이터, Auth 사용자, Storage 객체, Edge Function secret은 복사하지 않는다.

### Fresh project bootstrap note

Supabase 신규 project에서 `pgcrypto`가 `extensions` schema로 생성되면 historical migration `012`의 unqualified `gen_random_bytes`가 `db push` 중 해석되지 않을 수 있다. 빈 staging project에서만 migration 전에 아래 one-off compatibility command를 실행한다. 적용된 historical migration은 수정하지 않는다.

```bash
npx supabase db query --linked "alter extension pgcrypto set schema public;"
```

## Production promotion

staging 증거가 승인된 뒤에도 production은 별도 배포다. 운영자는 production 명령 전 다음 세 값을 명시적으로 확인한다.

- Supabase project ref: `pcvpkndyqkljgbrvssza`
- Xcode scheme: `Stockly Staff`
- Bundle ID: `com.jinkim.storeinventory.poc`

migration은 forward-only다. archive 문제가 있으면 이전 TestFlight build를 유지하고, schema 또는 Function 문제는 새 corrective migration/function version으로 수정한다.
