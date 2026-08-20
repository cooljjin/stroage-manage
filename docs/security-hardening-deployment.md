# Stockly 보안 강화 배포 게이트

이 문서는 소스 구현과 실제 운영 변경을 분리하기 위한 실행 체크리스트입니다. 현재 브랜치의 파일을 만들었다는 사실은 DB, Edge Function, Vercel, GitHub 또는 설치된 앱에 적용되었다는 뜻이 아닙니다.

## 1. 사전 확인

- 운영 DB migration 이력과 로컬 `001~073`을 다시 비교한다.
- 운영에 적용된 `068`의 내용과 로컬 파일 해시가 같은지 확인한다.
- DB 백업/PITR 상태와 복구 담당자를 확인한다.
- 테스트는 별도 테스트 매장과 이름에 `테스트`가 포함된 상품만 사용한다.

## 2. 단계별 적용

1. `070_security_emergency_containment.sql`
2. `071_reversible_product_aliases.sql`
3. `072_safe_write_and_profile_apis.sql`
4. `073_recipe_import_limits_and_retention.sql`
5. PostgREST schema cache 갱신과 RPC 계약 확인
6. `recipe-import`, `recipe-import-cleanup`, `account-purge-scheduler`, `manage-account-deletion` Edge Function 배포
7. 서로 다른 값을 가진 `RECIPE_IMPORT_CLEANUP_SECRET`, `ACCOUNT_PURGE_SECRET`을 Edge secrets와 Vault에 저장
8. `supabase/sql/configure_retention_cron.sql`로 dry-run 일정만 등록
9. 웹 Preview에서 CSP·OAuth·업로드·가역 병합 검증
10. 웹 배포 후 새 iOS/Android 빌드를 설치해 실제 기기 검증
11. 기기 보급 범위를 확인한 뒤에만 `supabase/sql/post_native_security_lockdown.sql` 실행
12. dry-run과 테스트 삭제·재시도가 일치한 뒤 Cron body를 `dryRun=false`로 전환

## 3. 외부 콘솔에서 별도 수행할 항목

- Supabase Auth의 유출 비밀번호 보호 활성화
- 현재 운영 도메인의 Universal Links/App Links 설정은 PKCE 릴리스 안정화 후 후속 릴리스로 진행
- GitHub 저장소의 협업자, Vercel 연결, Actions secret을 확인한 뒤 private 전환
- GitHub secret scanning/push protection, Dependabot security updates, CodeQL 필수 검사와 `main` branch protection 활성화
- Vercel Preview에서 보안 헤더를 확인한 뒤 Production 반영

## 4. 중단 조건

- 새 RPC가 schema cache에 보이지 않음
- 운영과 로컬 migration 이력이 다름
- 다른 매장 데이터가 테스트 쿼리에 나타남
- 구버전 설치 앱이 남아 있어 직접 쓰기 권한 회수 시 업무 중단 가능
- 익명 사용자가 `SECURITY DEFINER` 함수를 실행할 수 있음
- 삭제 dry-run 대상 수와 테스트 대상 수가 다름

적용된 migration은 수정하거나 되돌리지 않는다. 문제가 생기면 배포를 멈추고 데이터 영향을 확인한 뒤 새 corrective migration을 만든다.
