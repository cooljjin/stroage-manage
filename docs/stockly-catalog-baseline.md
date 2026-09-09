# Stockly Catalog 기준선

- 확인일: 2026-09-08
- 실행 모델: `gpt-5.6-luna` (사용자 지정값, 다른 모델 위임 없음)
- 작업 위치: `/Users/jinkim/Desktop/stroage-manage`
- 브랜치: `feat/stockly-catalog`
- HEAD: `20058ef`
- 범위: Luna Task 01만 실행

## 변경 보호 기준

검증 시작 시점과 종료 시점 모두 다음 기존 사용자 변경을 유지했다.

- 수정: `docs/stockly-design-guidelines.md`
- 수정: `src/pages/HomePage.tsx`
- 기존 untracked 파일 7개 보존
- `main` 작업 없음
- 새 branch/worktree 없음
- commit/push/merge 없음
- 앱 코드, SQL, 환경설정 변경 없음
- 패키지 설치 없음
- 원격 DB 접근·조회·변경 없음

이번 Task에서 추가한 파일은 이 문서 하나다.

## 기준선 검증

| 검증 | 명령 | 결과 | exit code | 요약 |
| --- | --- | --- | ---: | --- |
| Node 테스트 | `node --test test/*.test.mjs tests/*.test.mjs` | FAIL (기존 실패) | 1 | 26개 중 25 pass, 1 fail. `tests/vertical-quantity-wheel-fractional-slots.test.mjs`가 `src/components/VerticalQuantityWheel.tsx`에서 `snapFractionalValueOnStep = true`를 찾지 못함. |
| 앱 빌드 | `npm run build` | PASS | 0 | `tsc -b` 및 Vite production build 성공. PWA service worker 생성 완료. 큰 chunk 경고만 출력됨. |
| 린트 | `npm run lint` | PASS | 0 | ESLint 오류 없음. |
| diff 검사 | `git diff --check` | PASS | 0 | whitespace 오류 없음. |

테스트 실패는 검증 중 수정하지 않았다. 실패한 테스트와 관련 소스는 이번 Task의 변경 대상이 아니며, 신규 변경으로 발생한 실패라는 근거가 없다.

## DB 실행 환경

### 로컬/격리 DB 확인

확인한 항목:

- `supabase` CLI: 미설치
- `docker`: 미설치
- `podman`: 미설치
- `psql`: 미설치
- `pg_isready`: 미설치
- 관련 로컬 DB listener: 확인되지 않음
- 저장소 내 확인된 Supabase 설정: `supabase/config.toml`
- 저장소 내 SQLite/DB 파일: 확인되지 않음
- migration 파일: `001_initial_inventory_schema.sql`부터 `082_handover_author_delete_policy.sql`까지 확인

따라서 이미 준비된 isolated DB가 없거나, 이 환경에서는 준비 여부와 접속 정보를 검증할 수 없다. migration replay와 SQL 계약 검증은 실행하지 않았다.

### SQL 검증 상태

`S` 검증: **BLOCKED**

- isolated DB 전체 migration replay: 미실행
- anon/타 매장/동시성/재시도/rollback 계약: 미실행
- 원격 migration/grants/RLS/RPC 비교: 미실행
- 원인: 로컬 DB 실행 도구·연결 대상이 준비되어 있지 않음
- 제한 준수: 설치하지 않았고 원격 DB에 접근하지 않음

## 다음 Task blocker

Task 02 시작 금지 상태다. Orchestrator가 Task 01 기준선을 검토하고, isolated DB와 migration replay 경로를 별도로 준비·승인하기 전까지 SQL 의존 Task는 보류한다. 현재 기존 Node 테스트 1건 실패도 먼저 별도 원인 판단이 필요하지만, 이 Task에서는 수정하지 않는다.
