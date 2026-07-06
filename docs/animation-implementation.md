# UI/UX Animation Implementation

## Goal

Capacitor로 패키징한 모바일 앱에서 웹사이트 같은 전환감을 줄이고, 업무 흐름을 방해하지 않는 빠른 피드백 중심 애니메이션을 단계적으로 적용한다.

## Principles

- 애니메이션은 100~250ms 범위에서 빠르게 유지한다.
- 기본 속성은 `opacity`, `transform`만 사용한다.
- 많은 행이 있는 테이블에는 stagger를 적용하지 않는다.
- `prefers-reduced-motion` 설정을 존중한다.
- 공통 preset을 먼저 만들고, 화면별 특수 애니메이션은 최소화한다.

## Applied

### 2026-07-05 - Phase 1

- `motion` 패키지 추가.
- 공통 애니메이션 preset 파일 추가: `src/lib/animations.ts`.
- `StatusMessage`에 fade + slight slide-up 적용.
- Reduced Motion 사용자는 opacity만 거의 즉시 표시되도록 처리.
- 번들 부담을 줄이기 위해 `motion.div` 대신 `LazyMotion` + `m.div` 사용.

확인 필요 화면:

- 재고현황: 로딩, 오류, 성공 메시지
- 재고 작업: 저장 성공/오류 메시지
- 부족 재고: 로딩/검색 결과 메시지
- 단체주문 계산: 로딩/오류/성공 메시지

### 2026-07-05 - Phase 2

- 공통 버튼 press 피드백 추가.
- 적용 클래스: `touch-button`, `primary-button`, `secondary-button`.
- 눌림 상태에서 `scale(0.97)` 적용.
- disabled 버튼에는 press 효과 제외.
- Reduced Motion 사용자는 scale/transition 제거.
- 기존 버튼 컴포넌트 구조를 대량 수정하지 않고 CSS 공통 클래스에서 처리.

확인 필요 화면:

- 하단 네비게이션과 상단 메뉴 버튼
- 재고 작업 저장/수량 조절 버튼
- 재고현황 발주 버튼
- 스캔 시작/중지 버튼
- 관리자 화면 추가/저장/삭제 버튼

### 2026-07-05 - Phase 3

- 자체 route state 기반 화면 전환에 짧은 Page transition 적용.
- 적용 위치: `App.tsx`의 로그인 이후 주요 앱 화면 영역.
- 효과: `opacity 0 -> 1`, `y 6 -> 0`, `160ms easeOut`.
- 뒤로가기 스크롤 복원과 충돌을 줄이기 위해 exit animation은 적용하지 않음.
- Reduced Motion 사용자는 이동/전환 애니메이션 없이 즉시 표시.
- 번들 부담을 줄이기 위해 `LazyMotion` + `m.div` 사용.

확인 필요 화면:

- 하단 네비게이션으로 주요 탭 이동
- 재고현황 → 재고 작업 → 뒤로가기
- 스캔 → 상품 등록/재고 작업 이동
- 관리자 메뉴 이동
- 긴 목록에서 뒤로가기 시 스크롤 위치 유지 여부

### 2026-07-05 - Phase 4

- `재고현황`, `부족재고` 로딩 상태에 Skeleton UI 적용.
- 공통 skeleton 컴포넌트 추가: `src/components/Skeleton.tsx`.
- 실제 목록 구조와 비슷하게 테이블형 skeleton과 모바일 카드형 skeleton 분리.
- 화면 낭독용 로딩 문구는 `sr-only`로 유지.
- Reduced Motion 사용자는 shimmer 애니메이션 제거.

확인 필요 화면:

- 재고현황 최초 진입 시 테이블 skeleton 높이와 실제 목록 전환
- 재고현황 간소화/전체 보기 상태별 skeleton 열 비율
- 부족재고 모바일 카드 skeleton
- 부족재고 데스크톱 테이블 skeleton
- 로딩 종료 후 화면 높이 튐이 과하지 않은지

### 2026-07-05 - Phase 5

- 소량 목록용 공통 컴포넌트 추가: `src/components/AnimatedList.tsx`.
- 홈 화면의 짧은 목록에 fade + slight slide-up 적용.
  - 금일/내일 입고품목
  - To do list
  - 인수인계
  - 인수인계 히스토리
- 단체주문 계산 화면의 선택 날짜 일정 카드 목록에 적용.
- 대량 테이블형 목록에는 적용하지 않음.
- Reduced Motion 사용자는 일반 `div`로 렌더링하여 움직임 제거.

확인 필요 화면:

- 홈 화면 진입 시 세 패널 목록이 과하게 움직이지 않는지
- 할 일/인수인계 추가 시 새 항목만 자연스럽게 들어오는지
- 인수인계 히스토리 모달에서 카드 등장감이 부담스럽지 않은지
- 단체주문 일정 카드 선택/수정 흐름에서 지연감이 없는지

### 2026-07-05 - Phase 6

- 성공 메시지에 체크 아이콘 scale-in 피드백 적용.
- 적용 위치: `StatusMessage type="success"`.
- 효과: 체크 아이콘 `opacity 0 -> 1`, `scale 0.8 -> 1`, `160ms easeOut`.
- 오류/안내 메시지는 기존 텍스트 중심 형태 유지.
- Reduced Motion 사용자는 아이콘 움직임 없이 즉시 표시.
- 햅틱 피드백은 사용자 요청에 따라 적용하지 않음.

확인 필요 화면:

- 재고 작업 저장 성공 메시지
- 재고현황 입고완료 성공 메시지
- 부족재고 없음 메시지
- 관리자 화면 저장/삭제 성공 메시지

## Next Candidates

1. Bottom Sheet 후보 정리
2. Modal/Bottom Sheet transition 기반
3. 탭 indicator animation

## Deferred

- Haptic feedback: 사용자 요청에 따라 제외.
- Swipe gesture: 삭제/완료 실수 위험이 있어 후순위.
- Pull to refresh: 캘린더 드래그, 웹뷰 스크롤과 충돌 가능성이 있어 후순위.
- Animated counter: 실제 재고 숫자의 정확한 인지가 우선이라 홈 통계 중심으로 검토.
- Shared layout animation: 구현 범위가 크고 회귀 위험이 있어 마지막 단계에서 검토.
