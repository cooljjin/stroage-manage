# Stockly 개발용 TestFlight API Key 배포

이 문서는 개발용 iOS 앱 `com.jinkim.stockly`를 Xcode Apple ID 로그인 세션 없이 archive/export하고, 명시적으로 요청한 경우 App Store Connect API Key로 TestFlight에 업로드하는 절차다.

직원 배포용 Bundle ID `com.jinkim.storeinventory.poc`에는 이 절차를 사용하지 않는다. 스크립트의 기본 채널은 개발용이며, 직원용 Bundle ID가 build 설정·archive·IPA 중 하나에서 발견되면 실패한다.

## 현재 대상

- 채널: 개발용
- Bundle ID: `com.jinkim.stockly`
- Team ID: `RQMBNM7XVV`
- Version: `1.0`
- Build: `81`
- Workspace: `ios/App/App.xcworkspace`
- Scheme/Target: `App`
- Configuration: `Release`

Build 번호를 변경한 뒤에는 실행 시 `--expected-build`를 함께 지정한다. App Store Connect에 이미 업로드된 build 번호는 재사용하지 않는다.

## 실행 흐름

저장소 루트에서 다음 명령을 실행한다.

```bash
npm run ios:testflight
```

기본 실행은 다음까지만 수행하고 upload는 하지 않는다.

1. `npm run ios:prepare:staging`으로 환경·bundle·Xcode target을 검증하고 웹 자산을 iOS에 copy
2. 기존 Release 서명 설정을 사용한 signed archive
3. `app-store-connect` 방식 IPA export
4. archive와 IPA의 Bundle ID·version·build number·codesign·embedded provisioning profile 검증

결과물은 `tmp/ios-testflight-api-key/run-*` 아래에 생성된다. `tmp/`, `*.xcarchive`, `*.ipa`는 Git에서 제외되어 있다.

업로드가 필요한 경우에만 로컬 검증이 끝난 뒤 다음처럼 명시적으로 실행한다.

```bash
npm run ios:testflight -- --upload
```

`--upload` 없이는 `xcrun altool`을 호출하지 않는다. 이 작업에서는 실제 upload를 실행하지 않았다.

## 서명 설정 보존

스크립트는 `ios/App/App.xcodeproj/project.pbxproj`의 인증서·Team·provisioning profile 설정을 수정하지 않는다. Archive는 `App` scheme의 기존 `Release` 설정을 그대로 사용하고, export 옵션에는 build 설정에서 읽은 기존 `PROVISIONING_PROFILE_SPECIFIER`만 전달한다.

자동 provisioning 업데이트 옵션을 사용하지 않으므로, 필요한 인증서와 프로파일이 Mac에 없으면 Apple ID 로그인으로 우회하지 않고 실패한다. 기존 서명 자산을 준비한 뒤 다시 실행한다.

## App Store Connect API Key 생성과 보관

Apple Developer 문서 기준으로 다음 순서로 준비한다.

1. App Store Connect의 `Users and Access > Integrations > App Store Connect API`로 이동한다.
2. `Team Keys`에서 `Generate API Key` 또는 `+`를 선택한다.
3. 업로드에 필요한 최소 역할을 선택한다. Apple의 build upload 안내에서 허용하는 역할은 Account Holder, Admin, App Manager, Developer다. Team Key는 팀의 모든 앱에 적용되므로 범위를 앱 하나로 제한할 수 없다.
4. 생성 후 Key ID와 Issuer ID를 확인하고 `.p8` private key를 한 번만 다운로드한다. Apple은 private key 사본을 보관하지 않으며 다운로드 링크도 재노출하지 않는다.
5. `.p8`은 저장소·소스·`.env`·CI 로그·채팅에 넣지 않는다. macOS 사용자 계정 외부에 공유하지 말고, 파일 권한을 소유자 전용으로 둔다.

altool이 기본으로 찾는 경로를 사용하려면 다음처럼 보관할 수 있다. `<KEY_ID>`는 실제 값으로 바꾸되 이 문서나 Git에는 실제 값을 기록하지 않는다.

```bash
mkdir -p ~/.appstoreconnect/private_keys
mv ~/Downloads/AuthKey_<KEY_ID>.p8 ~/.appstoreconnect/private_keys/
chmod 600 ~/.appstoreconnect/private_keys/AuthKey_<KEY_ID>.p8
```

실행 시 세 값은 현재 shell 또는 비밀관리 시스템에서만 환경변수로 주입한다. 실제 값은 history·로그에 남기지 않는다.

```bash
export ASC_API_KEY_PATH="$HOME/.appstoreconnect/private_keys/AuthKey_<KEY_ID>.p8"
export ASC_API_KEY_ID="<KEY_ID>"
export ASC_API_ISSUER_ID="<ISSUER_ID>"
npm run ios:testflight -- --upload
```

스크립트는 upload 때만 임시 `private_keys/AuthKey_<KEY_ID>.p8` symlink를 만들고 `API_PRIVATE_KEYS_DIR`로 `altool`에 전달한다. private key를 저장소 결과물로 복사하지 않으며, 종료 시 임시 symlink를 삭제한다. altool 출력의 Key ID와 Issuer ID는 표시 전에 redaction한다.

키가 유출되었거나 분실되었다고 의심되면 App Store Connect에서 즉시 revoke하고 새 키를 생성한다.

## 채널·메타데이터 검증

다음 값 중 하나라도 다르면 archive/export 전에 실패한다.

- scheme/target이 `App`이 아님
- Bundle ID가 `com.jinkim.stockly`가 아님
- 직원용 Bundle ID `com.jinkim.storeinventory.poc`가 선택됨
- Team ID가 `RQMBNM7XVV`가 아님
- version/build가 기대값과 다름
- Release 서명이 Manual이 아니거나 기존 provisioning profile 이름이 비어 있음

Archive와 IPA에는 추가로 다음을 검사한다.

- `codesign --verify --deep --strict`
- signed Identifier와 Team ID
- `Apple Distribution` 인증서
- `embedded.mobileprovision`의 application identifier와 Team ID
- IPA 내부 `CFBundleIdentifier`, `CFBundleShortVersionString`, `CFBundleVersion`

## 관련 공식 문서

- [Apple Developer: Upload builds](https://developer.apple.com/help/app-store-connect/manage-builds/upload-builds)
- [Apple Developer Documentation: Creating API Keys for App Store Connect API](https://developer.apple.com/documentation/appstoreconnectapi/creating-api-keys-for-app-store-connect-api)
