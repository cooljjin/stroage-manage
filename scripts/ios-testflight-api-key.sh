#!/usr/bin/env bash
set -Eeuo pipefail

umask 077

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
repo_root="$(cd -- "$script_dir/.." && pwd -P)"

workspace="$repo_root/ios/App/App.xcworkspace"
scheme="App"
configuration="Release"
channel="development"
expected_bundle_id="com.jinkim.stockly"
staff_bundle_id="com.jinkim.storeinventory.poc"
expected_team_id="RQMBNM7XVV"
expected_version="${STOCKLY_IOS_EXPECTED_VERSION:-1.0}"
expected_build="${STOCKLY_IOS_EXPECTED_BUILD:-82}"
output_dir_arg="${STOCKLY_IOS_OUTPUT_DIR:-}"
upload=false

build_settings=""
profile_name=""
run_dir=""
upload_private_keys_dir=""
upload_key_link=""
upload_output=""

print_usage() {
  cat <<'EOF'
Stockly iOS TestFlight archive/export workflow

Usage:
  npm run ios:testflight -- [options]

Options:
  --channel development       개발용 채널만 허용합니다 (기본값).
  --expected-build NUMBER    검사할 build 번호 (기본값: 82).
  --output-dir PATH          결과를 둘 상위 디렉터리 (기본값: tmp/ios-testflight-api-key).
  --upload                    로컬 검증 후 API Key로 TestFlight 업로드합니다.
  -h, --help                 도움말을 표시합니다.

Upload-only environment variables (모두 --upload 때 필요):
  ASC_API_KEY_PATH            App Store Connect에서 받은 .p8 경로
  ASC_API_KEY_ID              API Key ID
  ASC_API_ISSUER_ID           Issuer ID

기본 실행은 검증된 staging web 준비 -> signed archive -> IPA export 및
Bundle ID/version/build/codesign 검증까지만 수행합니다.
EOF
}

die() {
  printf '오류: %s\n' "$*" >&2
  exit 1
}

log_step() {
  printf '\n==> %s\n' "$*"
}

require_command() {
  local command_name="$1"
  command -v "$command_name" >/dev/null 2>&1 || die "필수 명령을 찾을 수 없습니다: $command_name"
}

read_build_setting() {
  local setting_name="$1"
  awk -v key="$setting_name" '
    $0 ~ "^[[:space:]]*" key " = " {
      line = $0
      sub("^[[:space:]]*" key " = ", "", line)
      print line
      exit
    }
  ' <<<"$build_settings"
}

load_build_settings() {
  if ! build_settings="$(xcodebuild \
    -workspace "$workspace" \
    -scheme "$scheme" \
    -configuration "$configuration" \
    -destination 'generic/platform=iOS' \
    -showBuildSettings 2>&1)"; then
    printf '%s\n' "$build_settings" >&2
    die "Xcode Release build 설정을 읽지 못했습니다."
  fi
}

assert_build_setting() {
  local setting_name="$1"
  local expected_value="$2"
  local actual_value

  actual_value="$(read_build_setting "$setting_name")"
  [[ -n "$actual_value" ]] || die "Xcode Release build 설정에 $setting_name 값이 없습니다."

  if [[ "$actual_value" != "$expected_value" ]]; then
    if [[ "$setting_name" == "PRODUCT_BUNDLE_IDENTIFIER" && "$actual_value" == "$staff_bundle_id" ]]; then
      die "직원용 채널 Bundle ID($staff_bundle_id)가 선택되었습니다. 개발용 scheme App만 사용해야 합니다."
    fi
    die "$setting_name 불일치: 기대값=$expected_value 실제값=$actual_value"
  fi
}

validate_channel_and_build_settings() {
  [[ "$channel" == "development" ]] || die "지원하지 않는 채널입니다: $channel (개발용은 --channel development만 사용)"
  [[ -d "$workspace" ]] || die "workspace를 찾을 수 없습니다: ios/App/App.xcworkspace"

  load_build_settings
  assert_build_setting "TARGET_NAME" "App"
  assert_build_setting "PRODUCT_BUNDLE_IDENTIFIER" "$expected_bundle_id"
  assert_build_setting "DEVELOPMENT_TEAM" "$expected_team_id"
  assert_build_setting "MARKETING_VERSION" "$expected_version"
  assert_build_setting "CURRENT_PROJECT_VERSION" "$expected_build"
  assert_build_setting "CODE_SIGN_STYLE" "Manual"

  profile_name="$(read_build_setting PROVISIONING_PROFILE_SPECIFIER)"
  [[ -n "$profile_name" ]] || die "기존 Release provisioning profile 설정이 비어 있습니다. 서명 설정을 자동으로 바꾸지 않고 중단합니다."
}

validate_upload_credentials() {
  local key_header

  [[ -n "${ASC_API_KEY_PATH:-}" ]] || die "--upload에는 ASC_API_KEY_PATH 환경변수가 필요합니다."
  [[ -n "${ASC_API_KEY_ID:-}" ]] || die "--upload에는 ASC_API_KEY_ID 환경변수가 필요합니다."
  [[ -n "${ASC_API_ISSUER_ID:-}" ]] || die "--upload에는 ASC_API_ISSUER_ID 환경변수가 필요합니다."
  [[ -f "$ASC_API_KEY_PATH" && -r "$ASC_API_KEY_PATH" ]] || die "ASC_API_KEY_PATH가 읽을 수 있는 .p8 파일이 아닙니다."
  [[ "$ASC_API_KEY_PATH" == *.p8 ]] || die "ASC_API_KEY_PATH는 .p8 파일이어야 합니다."
  [[ "$ASC_API_KEY_ID" =~ ^[A-Za-z0-9]+$ ]] || die "ASC_API_KEY_ID 형식이 올바르지 않습니다."
  [[ "$ASC_API_ISSUER_ID" =~ ^[0-9A-Fa-f-]{36}$ ]] || die "ASC_API_ISSUER_ID 형식이 올바르지 않습니다."

  key_header="$(head -n 1 "$ASC_API_KEY_PATH")"
  [[ "$key_header" == "-----BEGIN PRIVATE KEY-----" ]] || die "ASC_API_KEY_PATH가 PKCS#8 private key(.p8) 형식이 아닙니다."
}

cleanup() {
  if [[ -n "$upload_key_link" && -L "$upload_key_link" ]]; then
    rm -f -- "$upload_key_link"
  fi
  if [[ -n "$upload_private_keys_dir" && -d "$upload_private_keys_dir" ]]; then
    rmdir -- "$upload_private_keys_dir" 2>/dev/null || true
  fi
  if [[ -n "$upload_output" && -f "$upload_output" ]]; then
    rm -f -- "$upload_output"
  fi
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --channel)
      [[ $# -ge 2 ]] || die "--channel에는 값이 필요합니다."
      channel="$2"
      shift 2
      ;;
    --expected-build)
      [[ $# -ge 2 ]] || die "--expected-build에는 값이 필요합니다."
      expected_build="$2"
      shift 2
      ;;
    --output-dir)
      [[ $# -ge 2 ]] || die "--output-dir에는 값이 필요합니다."
      output_dir_arg="$2"
      shift 2
      ;;
    --upload)
      upload=true
      shift
      ;;
    -h|--help)
      print_usage
      exit 0
      ;;
    *)
      die "알 수 없는 옵션입니다: $1 ( --help 참고)"
      ;;
  esac
done

[[ "$expected_build" =~ ^[0-9]+$ ]] || die "expected build 번호는 숫자여야 합니다: $expected_build"

for command_name in npm npx xcodebuild codesign security plutil unzip awk grep mktemp; do
  require_command "$command_name"
done
[[ -x /usr/libexec/PlistBuddy ]] || die "/usr/libexec/PlistBuddy를 찾을 수 없습니다."

if [[ "$upload" == true ]]; then
  validate_upload_credentials
fi

if [[ -n "$output_dir_arg" ]]; then
  case "$output_dir_arg" in
    /*) base_output_dir="$output_dir_arg" ;;
    *) base_output_dir="$repo_root/$output_dir_arg" ;;
  esac
else
  base_output_dir="$repo_root/tmp/ios-testflight-api-key"
fi
mkdir -p -- "$base_output_dir"
run_dir="$(mktemp -d "$base_output_dir/run-XXXXXX")"
trap cleanup EXIT

archive_path="$run_dir/App.xcarchive"
export_dir="$run_dir/export"
export_options_path="$run_dir/export-options.plist"
mkdir -p -- "$export_dir"

printf '채널: 개발용 (%s)\n' "$expected_bundle_id"
printf 'Team: %s / Version: %s / Build: %s\n' "$expected_team_id" "$expected_version" "$expected_build"
printf '직원용 채널(%s)은 이 workflow에서 거부됩니다.\n' "$staff_bundle_id"

log_step "채널 및 기존 서명 설정 확인"
validate_channel_and_build_settings
printf '기존 provisioning profile 설정 유지: %s\n' "$profile_name"

log_step "검증된 staging 웹 앱 build 및 Capacitor copy"
(cd "$repo_root" && npm run ios:prepare:staging)

log_step "sync 후 채널 및 서명 설정 재확인"
validate_channel_and_build_settings

log_step "signed archive"
xcodebuild \
  -workspace "$workspace" \
  -scheme "$scheme" \
  -configuration "$configuration" \
  -destination 'generic/platform=iOS' \
  -archivePath "$archive_path" \
  archive

archive_app_path="$archive_path/Products/Applications/App.app"
archive_info_path="$archive_app_path/Info.plist"
[[ -d "$archive_app_path" && -f "$archive_info_path" ]] || die "archive 안에서 App.app을 찾지 못했습니다."

plist_value() {
  local key_path="$1"
  local plist_path="$2"
  /usr/libexec/PlistBuddy -c "Print :$key_path" "$plist_path" 2>/dev/null
}

assert_app_metadata() {
  local label="$1"
  local info_path="$2"
  local bundle_id
  local version
  local build

  bundle_id="$(plist_value CFBundleIdentifier "$info_path")" || die "$label Info.plist에서 Bundle ID를 읽지 못했습니다."
  version="$(plist_value CFBundleShortVersionString "$info_path")" || die "$label Info.plist에서 version을 읽지 못했습니다."
  build="$(plist_value CFBundleVersion "$info_path")" || die "$label Info.plist에서 build number를 읽지 못했습니다."

  [[ "$bundle_id" == "$expected_bundle_id" ]] || die "$label Bundle ID 불일치: 개발용 $expected_bundle_id가 아닌 $bundle_id"
  [[ "$version" == "$expected_version" ]] || die "$label version 불일치: 기대값=$expected_version 실제값=$version"
  [[ "$build" == "$expected_build" ]] || die "$label build number 불일치: 기대값=$expected_build 실제값=$build"
}

assert_code_signing() {
  local label="$1"
  local app_path="$2"
  local profile_path="$app_path/embedded.mobileprovision"
  local profile_plist="$run_dir/$label-embedded-profile.plist"
  local signing_details
  local profile_app_id
  local profile_team_id

  if ! codesign --verify --deep --strict --verbose=2 "$app_path"; then
    die "$label codesign 검증에 실패했습니다."
  fi

  signing_details="$(codesign -dv --verbose=4 "$app_path" 2>&1)"
  grep -Fqx "Identifier=$expected_bundle_id" <<<"$signing_details" || die "$label signed Identifier가 개발용 Bundle ID와 다릅니다."
  grep -Fqx "TeamIdentifier=$expected_team_id" <<<"$signing_details" || die "$label signed Team ID가 기대값과 다릅니다."
  grep -Fq "Authority=Apple Distribution" <<<"$signing_details" || die "$label가 Apple Distribution 인증서로 서명되지 않았습니다."

  [[ -f "$profile_path" ]] || die "$label에 embedded.mobileprovision이 없습니다."
  security cms -D -i "$profile_path" -o "$profile_plist" >/dev/null 2>&1 || die "$label embedded provisioning profile을 해석하지 못했습니다."
  profile_app_id="$(/usr/libexec/PlistBuddy -c "Print :Entitlements:application-identifier" "$profile_plist" 2>/dev/null)" || die "$label provisioning profile의 application-identifier를 읽지 못했습니다."
  profile_team_id="$(/usr/libexec/PlistBuddy -c "Print :Entitlements:com.apple.developer.team-identifier" "$profile_plist" 2>/dev/null)" || die "$label provisioning profile의 team identifier를 읽지 못했습니다."
  [[ "$profile_app_id" == "$expected_team_id.$expected_bundle_id" ]] || die "$label provisioning profile application-identifier가 개발용 Bundle ID와 다릅니다."
  [[ "$profile_team_id" == "$expected_team_id" ]] || die "$label provisioning profile Team ID가 기대값과 다릅니다."
}

assert_app_metadata "archive" "$archive_info_path"
assert_code_signing "archive" "$archive_app_path"
printf 'archive metadata/codesign 검증 통과\n'

log_step "IPA export"
plutil -create xml1 "$export_options_path"
plutil -insert method -string app-store-connect "$export_options_path"
plutil -insert destination -string export "$export_options_path"
plutil -insert signingStyle -string manual "$export_options_path"
plutil -insert teamID -string "$expected_team_id" "$export_options_path"
plutil -insert manageAppVersionAndBuildNumber -bool false "$export_options_path"
/usr/libexec/PlistBuddy -c "Add :provisioningProfiles dict" "$export_options_path"
/usr/libexec/PlistBuddy -c "Add :provisioningProfiles:$expected_bundle_id string $profile_name" "$export_options_path"

xcodebuild \
  -exportArchive \
  -archivePath "$archive_path" \
  -exportPath "$export_dir" \
  -exportOptionsPlist "$export_options_path"

ipa_paths=()
while IFS= read -r -d '' ipa_path; do
  ipa_paths+=("$ipa_path")
done < <(find "$export_dir" -maxdepth 1 -type f -name '*.ipa' -print0)
[[ "${#ipa_paths[@]}" -eq 1 ]] || die "export 결과에서 IPA를 하나만 찾을 수 없습니다. 발견 수: ${#ipa_paths[@]}"
ipa_path="${ipa_paths[0]}"

ipa_entries_path="$run_dir/ipa-entries.txt"
unzip -Z1 "$ipa_path" > "$ipa_entries_path"
ipa_info_entry="$(grep -E '^Payload/[^/]+\.app/Info\.plist$' "$ipa_entries_path")"
[[ -n "$ipa_info_entry" ]] || die "IPA 안에서 Payload/*.app/Info.plist를 찾지 못했습니다."
ipa_app_entry="${ipa_info_entry%/Info.plist}"
ipa_unpack_dir="$run_dir/ipa-unpacked"
mkdir -p -- "$ipa_unpack_dir"
unzip -q "$ipa_path" -d "$ipa_unpack_dir"
ipa_app_path="$ipa_unpack_dir/$ipa_app_entry"
[[ -d "$ipa_app_path" ]] || die "IPA 압축 해제 결과에서 앱을 찾지 못했습니다."

assert_app_metadata "IPA" "$ipa_app_path/Info.plist"
assert_code_signing "IPA" "$ipa_app_path"
printf 'IPA metadata/codesign 검증 통과: %s\n' "$ipa_path"

if [[ "$upload" == true ]]; then
  log_step "API Key TestFlight upload"
  upload_private_keys_dir="$(mktemp -d "$run_dir/private-keys-XXXXXX")"
  upload_key_link="$upload_private_keys_dir/AuthKey_${ASC_API_KEY_ID}.p8"
  ln -s "$ASC_API_KEY_PATH" "$upload_key_link"
  upload_output="$(mktemp -t stockly-api-upload.XXXXXX)"

  if API_PRIVATE_KEYS_DIR="$upload_private_keys_dir" xcrun altool \
    --upload-app \
    -f "$ipa_path" \
    -t ios \
    --api-key "$ASC_API_KEY_ID" \
    --api-issuer "$ASC_API_ISSUER_ID" \
    --output-format normal >"$upload_output" 2>&1; then
    upload_status=0
  else
    upload_status=$?
  fi

  REDACT_KEY_ID="$ASC_API_KEY_ID" REDACT_ISSUER_ID="$ASC_API_ISSUER_ID" awk '{
    gsub(ENVIRON["REDACT_KEY_ID"], "[redacted-key-id]")
    gsub(ENVIRON["REDACT_ISSUER_ID"], "[redacted-issuer-id]")
    print
  }' "$upload_output"
  rm -f -- "$upload_output"
  upload_output=""

  [[ "$upload_status" -eq 0 ]] || die "API Key upload에 실패했습니다. 위의 비밀값 제거된 altool 출력만 확인하세요."
  printf 'API Key upload 명령이 완료되었습니다. Apple processing/TestFlight 노출은 별도 확인이 필요합니다.\n'
else
  printf '업로드 생략: 실제 TestFlight upload는 --upload 옵션이 있을 때만 실행됩니다.\n'
fi

printf '\n완료: archive/export 및 로컬 서명·IPA 메타데이터 검증\n'
printf '결과 디렉터리: %s\n' "$run_dir"
