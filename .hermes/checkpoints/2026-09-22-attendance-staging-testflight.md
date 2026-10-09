# NFC 근태·급여 스테이징/TestFlight 재개 체크포인트

작성 시각: 2026-09-22 18:18 KST
저장소: `/Users/jinkim/Desktop/stroage-manage-main`
브랜치/기준 커밋: `main` / `6872dfa` (`origin/main`과 동일)
상태: 모든 기능 변경은 아직 **미커밋·미푸시**다. 운영 Supabase에는 적용하지 않았다.

## 완료

### 코드
- NFC 출퇴근, 실제 태그 시각/직원 입력 시각/관리자 확정 시각 분리, 근태 관리 권한, 일정·예외, 시급/급여 규칙, 수당 계산, 엑셀 내보내기를 구현했다.
- 네이티브 NFC URL은 `window.location.origin` 대신 `VITE_ATTENDANCE_LINK_HOST` 또는 기본값 `stroage-manage.vercel.app`을 사용한다.
- begin/finalize 요청 ID를 세션에 보존하고 성공 후에만 제거하도록 수정했다.
- begin 실패 시 같은 token/request ID로 `다시 시도`할 수 있다.
- finalize 응답이 `{status:"expired"}`이면 저장 성공으로 표시하지 않고 “저장되지 않았습니다. NFC를 다시 태그해 주세요.” 오류를 표시한다.
- iOS AASA 원본은 `public/apple-app-site-association`, Vercel well-known rewrite/header는 `vercel.json`에 있다.
- Associated Domains 소스 entitlement는 `ios/App/App/AppRelease.entitlements`에 `applinks:stroage-manage.vercel.app`으로 추가했다.

### 스테이징 Supabase
- 조직: `strage manage`
- 프로젝트: `stockly-staging`
- project ref: `nchvyxhyfatgwpvilbng`
- 프로젝트 상태: Healthy
- 원격 migration은 이미 `091`까지 있었고 `084`는 `product_catalog_foundation`이어서 신규 migration을 `092_nfc_attendance_payroll.sql`로 변경했다.
- `092`를 스테이징 SQL Editor에서 트랜잭션으로 적용했고 `supabase_migrations.schema_migrations`에 `092 / nfc_attendance_payroll`을 기록했다.
- 대시보드에서 Last migration이 `nfc_attendance_payroll`로 확인됐다.
- SQL 계약 `supabase/tests/092_nfc_attendance_payroll_contract.sql`을 스테이징 PostgreSQL에서 실행했다. 처음 발견된 계약 자체 오류 2건을 수정했다:
  - weekday 인자를 `1::smallint`로 명시
  - composite 반환 RPC를 `select result.* into ...` 형태로 수신
- 최종 계약은 오류 없이 끝났고 트랜잭션 rollback으로 fixture가 남지 않았다.
- readback: attendance table/RPC 존재, 11개 attendance 테이블 RLS 활성, authenticated begin 권한 있음, anon begin 권한 없음, fixture rollback 확인.
- `.env.staging.local`을 만들었다. staging URL/publishable key/attendance host가 있고 mode `0600`, `.gitignore` 대상이다. 값을 출력하거나 커밋하지 말 것.

### 검증
- `node --test tests/*.test.mjs`: 44/44 통과
- `npm run build`: 통과
- `npm run lint`: 통과
- `git diff --check`: 통과
- 추가 줄 비밀/위험 패턴 검사: clean
- 스테이징 PostgreSQL 계약: 통과

## 현재 차단 사항

1. **Associated Domains 서명 프로파일**
   - 개발용 scheme: `App`
   - Bundle ID: `com.jinkim.stockly`
   - Team: `RQMBNM7XVV`
   - Version: `1.0`
   - 로컬 Build: `78`
   - Release는 Manual signing, profile `Stockly App Store 1.0.40`.
   - 최종 독립 리뷰에서 이 프로파일에 Associated Domains capability / `com.apple.developer.associated-domains` entitlement가 없어 signed archive가 실패한다고 확인했다.
   - Apple Developer App ID에서 Associated Domains를 활성화하고 App Store 프로파일을 재생성·설치한 뒤 archive해야 한다. 기존 entitlement 소스만으로는 부족하다.

2. **AASA 미배포**
   - `https://stroage-manage.vercel.app/.well-known/apple-app-site-association`은 아직 SPA HTML과 `text/html`을 반환한다.
   - Vercel 프로젝트 `jin-kim-s-projects12/stroage-manage`는 CLI 인증·link 완료.
   - staging env를 넣은 preview deploy를 2회 시도했지만 CLI가 420초 timeout됐고 deployments가 `UNKNOWN`으로 남았다:
     - `stroage-manage-5fcsjik4h-jin-kim-s-projects12.vercel.app`
     - `stroage-manage-i58jmyzpp-jin-kim-s-projects12.vercel.app`
   - 중복 업로드하지 말고 먼저 이 deployments 상태/로그를 확인한다. 필요하면 취소/정리하고 main push 자동 배포 또는 Vercel production deploy로 AASA를 배포한다.
   - 배포 후 반드시 status 200, `Content-Type: application/json`, Team ID/Bundle ID, `/attendance/tag/*`를 실제 URL에서 확인한다.

3. **App Store Connect 세션/빌드 번호**
   - Aside에서 한때 App Store Connect 팀/Xcode Cloud 빌드 상세 접근을 확인했지만 `/apps`로 직접 이동하자 `authResult=FAILED`가 됐다. 재로그인이 필요할 수 있다.
   - 이전 화면에 Xcode Cloud 실패 build 85가 보였으나 이것이 개발용 TestFlight 최고 업로드 번호라는 증거는 아니다.
   - App Store Connect의 정확한 개발용 앱 `com.jinkim.stockly`에서 최고 업로드 번호를 다시 확인하고 그보다 큰 번호를 사용한다.

4. **Migration 084–091 원본 부재**
   - 스테이징 원격 이력에는 `084`–`091`이 있지만 현재 저장소는 `083` 다음이 신규 `092`다.
   - 이번 스테이징 TestFlight 검증에서 `092` 적용 및 실제 계약 통과는 확인됐지만, 저장소만으로 스테이징 전체 schema를 재현할 수 없다.
   - 운영 승격 전에는 원격에 적용된 `084`–`091`의 정확한 원본을 권위 있는 소스에서 복구하고 migration parity/replay를 검증해야 한다. 추측해 재작성하지 말 것.

## 의도적 보류

- Android `assetlinks.json`은 실제 release SHA-256 인증서 지문이 없어서 만들지 않았다. 이번 대상은 iOS 개발용 TestFlight이므로 iOS 배포 차단 사항은 아니지만 Android App Links는 미검증 상태다.
- `stroage-manage.vercel.app`은 환경 중립 Universal Link 호스트로 사용한다. 설치된 개발용 앱은 링크 token을 받아 staging Supabase에 요청한다. 웹 fallback은 staging E2E 수용 경로가 아니다.
- 운영 Supabase에는 migration을 적용하지 않는다.

## 다음 순서

1. Aside에서 App Store Connect 및 필요하면 Apple Developer 로그인을 복구한다.
2. 개발용 App ID `com.jinkim.stockly`에 Associated Domains를 활성화하고 App Store provisioning profile을 재생성/설치한다.
3. 현재 diff를 최종 확인하고 `main`에 커밋·푸시한다. 원격 main과 다시 동기화한 뒤 진행한다.
4. Vercel 배포를 완료하고 canonical AASA URL을 실제 JSON으로 readback한다.
5. App Store Connect에서 개발용 앱 Bundle ID와 최고 build 번호를 확인해 새 번호를 정한다.
6. `.env.staging.local`을 사용해 staging Supabase 번들을 빌드한다. 예: 환경을 export한 뒤 build → `npx cap sync ios`; 값은 로그에 출력하지 않는다.
7. unsigned Release device build를 다시 통과시킨다.
8. signed archive/export 후 IPA의 Bundle ID, version/build, signed Associated Domains entitlement, codesign을 확인한다.
9. Xcode 계정으로 업로드한다.
10. App Store Connect에서 처리 상태와 개발용 TestFlight 그룹 할당을 readback한다.
11. iPhone에서 cold start/foreground/잠금 해제 NFC Universal Link, begin/finalize 재시도, 만료 메시지를 확인한다.

## 현재 변경 파일

- `src/App.tsx`
- `src/components/AttendancePunchPrompt.tsx`
- `src/pages/AttendanceManagementPage.tsx`
- `src/lib/attendancePayroll.ts`
- `src/components/TopMenu.tsx`
- `src/lib/staffPermissions.ts`
- `src/routes/lazyPages.ts`
- `src/types/domain.ts`
- `src/types/supabase.ts`
- `supabase/migrations/092_nfc_attendance_payroll.sql`
- `supabase/tests/092_nfc_attendance_payroll_contract.sql`
- `tests/attendance-contract-source.test.mjs`
- `tests/attendance-payroll.test.mjs`
- `tests/attendance-ui-source.test.mjs`
- `ios/App/App/AppRelease.entitlements`
- `android/app/src/main/AndroidManifest.xml`
- `public/apple-app-site-association`
- `vercel.json`
- `.hermes/plans/2026-09-22_134259-attendance-nfc-payroll.md`

재개 요청 예시: “`/.hermes/checkpoints/2026-09-22-attendance-staging-testflight.md`부터 읽고 NFC 스테이징/TestFlight 배포 계속해줘.”
