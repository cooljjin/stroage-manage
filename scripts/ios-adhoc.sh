#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."

: "${STOCKLY_TEST_DEVICE_UDID:?Set the registered iPhone UDID}"
node --input-type=module <<'JS'
import { loadEnv } from 'vite';
const staging = loadEnv('staging', process.cwd(), 'VITE_');
const production = loadEnv('production', process.cwd(), 'VITE_');
for (const key of ['VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY']) {
  if (!staging[key] || staging[key] === production[key]) throw Error(`${key}: separate staging value required`);
}
JS

out="${STOCKLY_ADHOC_DIR:-$HOME/Stockly-Dev-Distributions}"
mkdir -p "$out"
archive="$out/Stockly-Dev.xcarchive"
export_dir="$out/export"
options="$out/ExportOptions.plist"

npm run build -- --mode staging
node --input-type=module <<'JS'
import { readFileSync } from 'node:fs';
import { loadEnv } from 'vite';
const staging = loadEnv('staging', process.cwd(), 'VITE_');
const production = loadEnv('production', process.cwd(), 'VITE_');
const html = readFileSync('dist/index.html','utf8');
const entry = html.match(/<script[^>]+src="([^"?]+\.js)/)?.[1];
if (!entry) throw Error('Missing built entry');
const js = readFileSync(`dist/${entry.replace(/^\//,'')}`,'utf8');
if (!js.includes(staging.VITE_SUPABASE_URL) || js.includes(production.VITE_SUPABASE_URL)) throw Error('Staging bundle isolation failed');
JS
npx cap sync ios
python3 - "$options" <<'PY'
import os,plistlib,sys
options=dict(method='release-testing', signingStyle='automatic', teamID='RQMBNM7XVV', manageAppVersionAndBuildNumber=False, destination='export')
if profile := os.environ.get('STOCKLY_ADHOC_PROFILE'):
    options.update(signingStyle='manual', signingCertificate='Apple Distribution', provisioningProfiles={'com.jinkim.stockly.dev':profile})
with open(sys.argv[1],'wb') as f:
    plistlib.dump(options,f)
PY
build_args=()
if [[ -n "${STOCKLY_BUILD_NUMBER:-}" ]]; then
  [[ "$STOCKLY_BUILD_NUMBER" =~ ^[0-9]+$ ]] || { printf 'Invalid build number\n' >&2; exit 1; }
  build_args+=("CURRENT_PROJECT_VERSION=$STOCKLY_BUILD_NUMBER")
fi
xcodebuild -workspace ios/App/App.xcworkspace -scheme App -configuration Debug -sdk iphoneos \
  -destination 'generic/platform=iOS' -archivePath "$archive" -allowProvisioningUpdates "${build_args[@]}" archive
xcodebuild -exportArchive -archivePath "$archive" -exportOptionsPlist "$options" \
  -exportPath "$export_dir" -allowProvisioningUpdates
python3 - "$export_dir" "$STOCKLY_TEST_DEVICE_UDID" <<'PY'
import glob,plistlib,subprocess,sys,tempfile,zipfile,os
ipas=glob.glob(os.path.join(sys.argv[1],'*.ipa'))
if len(ipas)!=1: raise SystemExit(f'Expected one IPA, found {len(ipas)}')
with zipfile.ZipFile(ipas[0]) as z:
    app=next((n for n in z.namelist() if n.startswith('Payload/') and n.endswith('.app/Info.plist') and n.count('/')==2),None)
    if not app: raise SystemExit('Missing app Info.plist')
    info=plistlib.loads(z.read(app))
    if info['CFBundleIdentifier']!='com.jinkim.stockly.dev': raise SystemExit('Wrong app identity')
    if info.get('StocklyDevServerURL')!='https://macmini-1.tailc45cff.ts.net:8443': raise SystemExit('Wrong dev server')
    with tempfile.TemporaryDirectory() as d:
        z.extractall(d)
        subprocess.run(['codesign','--verify','--deep','--strict',os.path.join(d,app.removesuffix('/Info.plist'))],check=True,stdout=subprocess.DEVNULL)
        signed=plistlib.loads(subprocess.check_output(['codesign','-d','--entitlements',':-',os.path.join(d,app.removesuffix('/Info.plist'))],stderr=subprocess.DEVNULL))
        if signed.get('com.apple.developer.associated-domains')!=['applinks:stroage-manage.vercel.app']: raise SystemExit('Signed Universal Link entitlement missing')
        if 'TAG' not in signed.get('com.apple.developer.nfc.readersession.formats',[]): raise SystemExit('Signed NFC TAG entitlement missing')
        p=os.path.join(d,app.replace('Info.plist','embedded.mobileprovision'))
        profile=plistlib.loads(subprocess.check_output(['security','cms','-D','-i',p],stderr=subprocess.DEVNULL))
    ent=profile['Entitlements']
    if ent.get('application-identifier')!='RQMBNM7XVV.com.jinkim.stockly.dev': raise SystemExit('Wrong provisioning App ID')
    if sys.argv[2] not in profile.get('ProvisionedDevices',[]): raise SystemExit('Target iPhone absent from provisioning profile')
    if ent.get('get-task-allow'): raise SystemExit('Development export, not Ad Hoc')
    print(f"Verified Ad Hoc IPA: {ipas[0]} (version {info['CFBundleShortVersionString']} build {info['CFBundleVersion']})")
PY
