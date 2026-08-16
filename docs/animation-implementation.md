# Stockly 애니메이션 적용 현황

마지막 코드 점검: 2026-08-13

## 목표와 원칙

Stockly의 애니메이션은 장식보다 빠른 상태 피드백과 화면 맥락 유지가 목적이다.

- 보통 100~250ms 안에서 끝낸다.
- 주로 `opacity`와 `transform`을 사용한다.
- 긴 테이블과 대량 목록에는 stagger를 적용하지 않는다.
- `prefers-reduced-motion`을 존중한다.
- 저장·삭제·재고 변경의 정확한 결과 표시를 움직임보다 우선한다.

## 현재 공통 구현

### Motion preset

- 파일: `src/lib/animations.ts`
- 라이브러리: `motion`
- `LazyMotion`, `domAnimation`, `m`을 사용해 공통 transition을 적용한다.

### 상태 메시지

- 파일: `src/components/StatusMessage.tsx`
- 정보·오류·성공 메시지에 fade와 짧은 slide-up을 적용한다.
- 성공 상태의 체크 아이콘은 scale-in으로 표시한다.
- Reduced Motion에서는 이동을 줄이고 거의 즉시 표시한다.

### 화면 전환

- 위치: `src/App.tsx`
- 로그인 뒤 route state가 바뀔 때 짧은 진입 transition을 적용한다.
- 뒤로가기 스크롤 복원과 충돌을 줄이기 위해 exit animation은 사용하지 않는다.

### 버튼 피드백

- 공통 CSS: `src/styles.css`
- `.touch-button`, `.primary-button`, `.secondary-button`의 눌림 상태에 작은 scale 변화를 적용한다.
- `.no-press-scale`은 레이아웃 또는 sticky header상 scale이 부적절한 버튼에 사용한다.
- `PressableButton`은 필요한 화면에서 surface feedback을 제공한다.

### Skeleton

- 파일: `src/components/Skeleton.tsx`
- 재고 현황과 부족 재고 로딩에 카드·테이블 형태의 skeleton을 사용한다.
- Reduced Motion에서는 shimmer를 제거한다.

### 짧은 목록

- 파일: `src/components/AnimatedList.tsx`
- 홈의 입고, To do, 인수인계와 관련 모달 목록에 적용한다.
- 단체주문 화면의 선택 날짜 일정에 적용한다.
- 긴 재고 테이블에는 적용하지 않는다.

### Stockly 메뉴 아이콘

- 파일: `src/components/StocklyStackIcon.tsx`
- 상단 메뉴의 열린/닫힌 상태를 짧은 층 이동으로 표시한다.

## 코드로 확인된 적용 화면

- 고객용 앱 주요 route 진입
- `StatusMessage`를 사용하는 저장·오류·안내 상태
- 재고 현황과 부족 재고 로딩
- 홈의 입고·할 일·인수인계 목록
- 입고·To do 캘린더와 히스토리 일부
- 단체주문 선택 일정 목록
- 공통 터치 버튼

## 실제 화면에서 확인할 항목

정적 코드 확인만 완료되었으며 다음은 브라우저와 기기에서 확인해야 한다.

- 긴 목록에서 뒤로가기 후 스크롤 위치가 유지되는지
- sticky header 버튼의 눌림 피드백이 잘리거나 흔들리지 않는지
- skeleton에서 실제 목록으로 전환할 때 높이 변화가 과하지 않은지
- 홈 목록이 여러 개 동시에 나타날 때 움직임이 과하지 않은지
- iPhone WebView에서 Reduced Motion 설정이 반영되는지
- 모달을 연속으로 열고 닫을 때 포커스와 스크롤이 안정적인지

## 다음 후보

1. 모달과 bottom sheet의 공통 진입·퇴장 transition
2. 탭 선택 indicator
3. 반복되는 dialog의 포커스 관리와 motion 통합

## 보류

- Haptic feedback: 현재 적용하지 않음
- Swipe 완료·삭제: 오작동 위험 때문에 후순위
- Pull to refresh: 캘린더와 WebView 스크롤 충돌 가능성 때문에 후순위
- 재고 숫자 animated counter: 정확한 수량 인지를 우선해 보류
- shared layout animation: 회귀 범위가 커서 보류
