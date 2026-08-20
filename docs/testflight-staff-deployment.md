# Stockly TestFlight 직원 배포

마지막 로컬 설정 점검: 2026-08-19

이 문서는 App Store Connect에 새 iOS build를 업로드해 직원에게 TestFlight로 배포하는 절차다. 실제 App Store Connect 상태와 사용 가능한 build는 로그인 후 다시 확인한다.

## 현재 로컬 설정

- 앱 이름: `Stockly`
- Bundle ID: `com.jinkim.stockly`
- Version: 1.0
- Build: 16 (현재 작업 트리 설정)
- iOS 최소 버전: 15.5
- workspace: `ios/App/App.xcworkspace`
- Capacitor `webDir`: `dist`
- `server.url`: 없음

설치 앱은 로컬 웹 번들을 포함하므로 코드 변경을 직원에게 반영하려면 새 TestFlight build가 필요하다.

## 업로드 전 확인

1. `git status --short`로 포함할 변경을 확인한다.
2. 필요한 Supabase migration과 Edge Function 배포 여부를 확인한다.
3. 고객용 앱을 검증한다.

```bash
npm run build
npm run lint
```

4. 이전에 App Store Connect에 업로드하지 않은 새 Build 번호로 올린다.
5. iOS 번들을 새로 준비한다.

```bash
npm run ios:prepare
npm run cap:ios
```

`ios:prepare`가 build를 다시 수행하므로 직전에 통과한 소스와 같은 작업 트리인지 확인한다.

## Archive

Xcode에서:

1. `App.xcworkspace`를 연다.
2. `App` target의 Signing Team과 Bundle ID를 확인한다.
3. Version과 Build를 확인한다.
4. 실행 대상을 `Any iOS Device (arm64)` 또는 현재 Xcode의 generic iOS device로 선택한다.
5. `Product > Archive`를 실행한다.

같은 Build 번호는 다시 업로드할 수 없다. 현재 로컬 값이 16이더라도 App Store Connect에 16이 이미 존재하면 17 이상을 사용한다.

## App Store Connect 업로드

Organizer에서:

1. 새 Archive 선택
2. `Distribute App`
3. `App Store Connect`
4. `Upload`
5. 서명과 validation 결과 확인
6. 업로드 완료

Apple processing이 끝난 뒤 TestFlight 탭에서 build 상태와 export compliance를 확인한다. `Info.plist`에는 현재 `ITSAppUsesNonExemptEncryption=false`가 설정되어 있다.

## 테스터 배포

### 내부 테스터

App Store Connect 사용자로 등록된 팀원에게 빠르게 배포할 때 사용한다. 외부 Beta App Review가 필요하지 않은 경우가 있지만 App Store Connect 역할이 필요하다.

### 외부 테스터

일반 직원 이메일 또는 공개 링크로 배포할 때 사용한다.

1. `TestFlight > External Testing`에서 그룹 생성
2. 처리 완료된 build 추가
3. 테스트 설명과 연락처 입력
4. 필요하면 Beta App Review 제출
5. 승인 뒤 이메일 또는 공개 링크 공유

외부 테스터의 첫 build나 중요한 변경은 Beta App Review가 필요할 수 있다.

## 권장 테스트 내용

- 이메일과 OAuth 로그인 후 앱 복귀
- 초대코드 입력과 매장 연결
- iPhone native 바코드 스캔
- 기본·보조·미등록 바코드 이동
- 입고, 사용, 이동, 실사 저장
- 부족재고 품목추가, 컨펌, 발주하기
- 홈의 입고 예정·완료, To do, 인수인계
- 오프라인 배너와 네트워크 오류 복구
- 계정 탈퇴 분기

## 업데이트 흐름

1. 코드·DB·함수 변경 범위 확정
2. build/lint와 필요한 브라우저·기기 검증
3. 새 Build 번호 설정
4. `npm run ios:prepare`
5. Archive와 Upload
6. TestFlight 처리·검토 상태 확인
7. 대상 그룹에 build 배포
8. 실제 직원 iPhone에서 설치된 Version/Build 확인

배포는 사용자의 명시적 지시가 있을 때만 진행한다.
