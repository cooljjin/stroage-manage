# 홈 인수인계 작성·노출기간·캘린더 히스토리 구현 계획

> **For Hermes:** Use this plan as the implementation checklist while preserving existing HomePage, RLS, and dashboard date behavior.

**Goal:** 홈 화면의 인수인계 카드에 `+` 작성 팝업, 노출 종료일을 드래그로 지정하는 캘린더, 작성자 삭제, 캘린더형 히스토리를 추가한다.

**Architecture:** 기존 `handover_notes` 테이블과 `HomePage.tsx` 흐름을 확장한다. `handover_date`는 기존 시작/대시보드 날짜 의미를 유지하고, nullable `visible_until`을 추가해 종료일을 inclusive하게 저장한다. `visible_until IS NULL`은 작성자가 삭제할 때까지 노출하는 옵션으로 사용한다. 읽기/작성은 기존 매장 범위 RLS를 유지하고, 삭제는 `created_by = auth.uid()`로 DB에서 강제한다.

**Tech Stack:** React 18, TypeScript, Tailwind, Supabase DatabaseService, 기존 `businessCalendar` 날짜 유틸, Node TypeScript-strip source regression test.

---

## 요구사항 해석 및 기본값

- `+` 버튼은 오늘/내일 탭과 무관하게 인수인계 SectionHeader에서 히스토리 버튼 왼편에 항상 표시한다.
- 작성 시작일은 오늘(`Asia/Seoul`)로 저장해 작성 직후 오늘 홈과 이후 홈 날짜에 노출될 수 있게 한다.
- 종료일 선택 캘린더의 기본값은 다음 영업일이며, 오늘부터 선택 가능하다.
- 종료일은 선택 날짜까지 포함해 노출한다.
- `작성자가 삭제할 때까지`를 선택하면 `visible_until = null`로 저장한다.
- 히스토리는 모든 매장 인수인계의 날짜별 개수를 캘린더에 표시하고, 날짜를 누르면 그 날짜의 내용을 아래에 표시한다.
- 삭제 버튼은 본인이 작성한 항목에만 보이며, Supabase RLS도 작성자만 삭제할 수 있도록 강제한다.

## Task 1: 데이터 모델과 보안 정책

**Files:**
- Create: `supabase/migrations/081_handover_visibility_schedule.sql`
- Modify: `src/types/domain.ts`
- Modify: `src/types/supabase.ts`

**Changes:**
- `handover_notes.visible_until date null` 추가.
- `(store_id, handover_date, visible_until)` 조회 보조 인덱스 추가.
- 기존 삭제 정책을 작성자 전용 정책으로 교체.
- `HandoverNote`, Supabase Row/Insert/Update 타입에 `visible_until` 추가.

**Validation:**
- migration dry-run 후 원격 적용.
- `information_schema` 컬럼, policy, index read-back.
- `npx supabase db lint --linked --level warning`.

## Task 2: 회귀 테스트 RED 추가

**Files:**
- Modify: `scripts/mobile-inventory.test.mts`

**Assertions:**
- HomePage가 `visible_until`을 조회/저장한다.
- 히스토리 왼편에 `인수인계 추가` 버튼이 있다.
- 내용 입력 단계와 `노출 기간` 캘린더 단계가 분리되어 있다.
- 캘린더 셀이 pointer drag 이벤트를 지원한다.
- `작성자가 삭제할 때까지` 옵션과 `visible_until: null` 저장이 있다.
- 히스토리 캘린더와 날짜별 선택 목록이 있다.
- 삭제 시 `created_by`와 매장 범위를 함께 제한한다.

Run: `node --experimental-strip-types scripts/mobile-inventory.test.mts`
Expected before implementation: FAIL on the first new assertion.

## Task 3: 작성 팝업과 노출기간 캘린더

**Files:**
- Modify: `src/pages/HomePage.tsx`

**Changes:**
- 기존 인라인 `showHandoverForm`을 내용 입력 dialog로 전환.
- `다음: 노출 기간` 클릭 시 입력값을 유지한 채 노출기간 dialog로 이동.
- 오늘부터 선택 가능한 42칸 월 캘린더 구현.
- 날짜 셀 pointer down/move/up으로 종료일을 드래그 선택.
- 캘린더 월 이동, 종료일 미리보기, 무기한 체크박스 구현.
- 저장 시 `handover_date = todayValue`, 선택 종료일 또는 null, `created_by = auth.uid()`로 insert.
- 저장/취소/뒤로가기/탭 전환 시 draft와 drag state 초기화.

## Task 4: 홈 노출·작성자 삭제

**Files:**
- Modify: `src/pages/HomePage.tsx`

**Changes:**
- dashboard 날짜에 대해 `handover_date <= dashboardDate`이고 `visible_until IS NULL OR visible_until >= dashboardDate`인 항목을 로드.
- 카드에 노출 종료일 또는 `작성자 삭제 시까지` 표시.
- 현재 사용자 작성 항목에만 삭제 버튼 표시.
- delete query에 `store_id`, `id`, `created_by`를 모두 포함하고 삭제 후 dashboard/history 상태를 갱신.

## Task 5: 캘린더형 히스토리

**Files:**
- Modify: `src/pages/HomePage.tsx`

**Changes:**
- 기존 리스트 히스토리 modal을 월 캘린더 + 날짜별 목록으로 변경.
- 날짜별 인수인계 개수 badge/dot 표시.
- 날짜 선택 시 해당 날짜의 note 목록 표시.
- 히스토리 목록에서도 작성자 본인 항목만 삭제 가능.
- month navigation과 빈 날짜 상태를 처리.

## Task 6: 검증 및 개발서버 확인

Run:
- `node --experimental-strip-types scripts/mobile-inventory.test.mts`
- `npm run build`
- `npm run lint`
- `git diff --check`
- `npx supabase db lint --linked --level warning`
- `npx supabase db push --linked --dry-run`
- remote migration apply and read-back
- local server `curl -fsSI http://127.0.0.1:5173/`
- Playwright mobile viewport DOM/screenshot check for button ordering, dialogs, calendar labels, and pointer-visible controls.

**Risks:**
- 기존 `handover_date` 기반 데이터는 `visible_until = null`로 계속 노출되므로 의미가 바뀌지 않는다.
- 삭제 RLS 강화로 다른 작성자의 기존 미래 인수인계는 더 이상 삭제할 수 없다.
- 실제 인증 계정의 Supabase RLS와 터치 drag는 브라우저 source check와 별도로 실기기에서 최종 확인한다.
