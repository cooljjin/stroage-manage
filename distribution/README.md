# Stockly Dev Firebase 배포

```bash
node scripts/distribute-ios.mjs --preflight  # 읽기 전용 대상·테스터·빌드 번호 확인
node scripts/distribute-ios.mjs              # staging 빌드 → Ad Hoc IPA → 업로드 → 재조회
```

- 대상: `App` / `Debug` / `com.jinkim.stockly.dev`, Firebase `stockly-dev-d3c5b`.
- 테스터: `stockly-dev-testers`의 기존 1명. 다른 앱·그룹으로 대체하지 않는다.
- 인증: `GOOGLE_APPLICATION_CREDENTIALS` 또는 `~/.config/stockly/firebase-app-distribution.json` (0600). 키는 저장소 밖에 둔다.
- Ad Hoc 내보내기는 `firebase.json`의 `adHocProfileName`(`Stockly Dev NFC Ad Hoc`)을 사용한다. 프로파일은 기존 배포 인증서·등록 iPhone과 NFC/Associated Domains 권한을 포함해야 한다. IPA의 실제 서명에서 TAG와 앱 링크 도메인을 검사하며, 누락 시 업로드 전에 중단한다. 프로파일 만료·권한 변경 때만 Apple Developer에서 갱신한다.
- Firebase IPA 배포와 공개 AASA 배포는 별도다. Firebase 성공만으로 NFC 앱 실행이 완성됐다고 보고하지 않는다.
- 현재 작업 트리의 추적·미추적 소스를 별도 디렉터리로 복사하므로 커밋하지 않은 UI 변경도 포함한다. 원본 native 설정/Pods는 sync하지 않는다.
- Firebase 배포 이력·로컬 설정·기존 산출물보다 높은 빌드 번호를 사용한다. 성공하면 원본 App Debug 번호만 올리고 Release/직원용 번호는 보존한다.
- IPA의 서명·프로파일·등록 기기·앱 ID·화면 문구와 staged/archive/IPA 화면 번들 일치를 검사한다. 업로드 뒤 정확한 버전/빌드를 Firebase REST로 재조회한다.
- 산출물/비공개 로그: `~/Stockly-Dev-Distributions/firebase-<version>-<build>/`. 최종 JSON `status`가 `success`일 때만 성공이다. `failed`/`unverified`면 해당 stage와 로그를 조사하고 이미 업로드됐는지 먼저 확인한다.
- 앱은 Live Reload를 유지하므로 Mac 개발 서버와 iPhone Tailscale/DNS 연결이 필요하다. Firebase 배포 성공은 다운로드·설치·실기기 검증 완료가 아니다.
