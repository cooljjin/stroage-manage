/* global fetch */
import process from 'node:process';
import { Buffer } from 'node:buffer';
import { URLSearchParams } from 'node:url';
import console from 'node:console';
import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync, openSync, closeSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { createSign } from 'node:crypto';
import { execFileSync } from 'node:child_process';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const c = JSON.parse(readFileSync(join(root, 'distribution/firebase.json'), 'utf8'));
const home = homedir();
const credential = process.env.GOOGLE_APPLICATION_CREDENTIALS || join(home, '.config/stockly/firebase-app-distribution.json');
const base = join(home, 'Stockly-Dev-Distributions');
const parent = `projects/${c.firebaseProjectNumber}/apps/${c.firebaseAppId}`;
const resumeArg = process.argv.find(value => value.startsWith('--resume='));
const preparedOut = resumeArg ? resolve(resumeArg.slice('--resume='.length)) : null;
if (preparedOut && (dirname(preparedOut) !== base || !/^firebase-[\d.]+-\d+$/.test(preparedOut.split('/').pop()))) throw Error('Invalid prepared artifact directory');
const preparation = preparedOut ? JSON.parse(readFileSync(join(preparedOut, 'preparation.json'), 'utf8')) : null;
const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
let stage = 'preflight';
let lock;
let log;

function run(command, args, cwd = root, env = process.env) {
  return execFileSync(command, args, { cwd, env, stdio: log ? ['ignore', log, log] : ['ignore', 'pipe', 'pipe'] });
}
async function get(path, token, management = false) {
  const response = await fetch(`https://${management ? 'firebase.googleapis.com/v1beta1' : 'firebaseappdistribution.googleapis.com/v1'}/${path}`, { headers: { authorization: `Bearer ${token}` } });
  if (!response.ok) throw Error(`Firebase HTTP ${response.status}: ${path}`);
  return response.json();
}
async function authenticate() {
  if (resolve(credential).startsWith(root + '/')) throw Error('Credential must be outside repository');
  if ((statSync(credential).mode & 0o077) !== 0) throw Error('Credential file must be private (0600)');
  const a = JSON.parse(readFileSync(credential, 'utf8'));
  if (a.type !== 'service_account' || a.project_id !== c.firebaseProjectId || a.token_uri !== 'https://oauth2.googleapis.com/token') throw Error('Wrong service-account project');
  const now = Math.floor(Date.now() / 1000);
  const unsigned = `${encode({ alg: 'RS256', typ: 'JWT' })}.${encode({ iss: a.client_email, scope: 'https://www.googleapis.com/auth/cloud-platform', aud: a.token_uri, iat: now, exp: now + 3600 })}`;
  const signature = createSign('RSA-SHA256').update(unsigned).sign(a.private_key, 'base64url');
  const response = await fetch(a.token_uri, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${unsigned}.${signature}` }) });
  const data = await response.json();
  if (!response.ok || !data.access_token) throw Error('Service-account authentication failed');
  return data.access_token;
}
async function releases(token) {
  const all = [];
  let next = '';
  do {
    const data = await get(`${parent}/releases?pageSize=100${next ? `&pageToken=${encodeURIComponent(next)}` : ''}`, token);
    all.push(...(data.releases || []));
    next = data.nextPageToken || '';
  } while (next);
  return all;
}

try {
  if (c.bundleId !== 'com.jinkim.stockly.dev' || c.scheme !== 'App' || c.configuration !== 'Debug' || c.firebaseProjectId !== 'stockly-dev-d3c5b' || c.firebaseProjectNumber !== '240782986167' || c.firebaseAppId !== '1:240782986167:ios:7893098158a4532af93632' || c.testerGroupAlias !== 'stockly-dev-testers') throw Error('Unexpected Stockly Dev destination');
  const token = await authenticate();
  const app = await get(`projects/${c.firebaseProjectId}/iosApps/${c.firebaseAppId}`, token, true);
  if (app.bundleId !== c.bundleId || app.appId !== c.firebaseAppId || app.projectId !== c.firebaseProjectId) throw Error('Firebase app identity mismatch');
  const group = await get(`projects/${c.firebaseProjectNumber}/groups/${c.testerGroupAlias}`, token);
  if (group.name !== `projects/${c.firebaseProjectNumber}/groups/${c.testerGroupAlias}` || group.testerCount !== 1) throw Error('Unexpected tester scope');
  const list = await releases(token);
  const settings = JSON.parse(run('xcodebuild', ['-workspace', 'ios/App/App.xcworkspace', '-scheme', c.scheme, '-configuration', c.configuration, '-sdk', 'iphoneos', '-showBuildSettings', '-json']).toString()).find(x => x.target === 'App').buildSettings;
  if (settings.PRODUCT_BUNDLE_IDENTIFIER !== c.bundleId || settings.DEVELOPMENT_TEAM !== 'RQMBNM7XVV') throw Error('Xcode app identity mismatch');
  const version = settings.MARKETING_VERSION;
  const previousBuild = Math.max(Number(settings.CURRENT_PROJECT_VERSION), ...list.map(r => Number(r.buildVersion) || 0), ...readdirSync(base).map(n => Number(n.match(/-(\d+)$/)?.[1]) || 0));
  const build = preparation ? String(preparation.build) : String(previousBuild + 1);
  if (preparation && (preparation.version !== version || Number(build) <= Math.max(0, ...list.map(r => Number(r.buildVersion) || 0)))) throw Error('Prepared version is outdated or already uploaded');
  if (process.argv.includes('--preflight')) {
    console.log(JSON.stringify({ status: 'ok', bundleId: c.bundleId, version, nextBuild: build, latestFirebaseBuild: Math.max(0, ...list.map(r => Number(r.buildVersion) || 0)), testerGroup: c.testerGroupAlias, testerCount: group.testerCount }));
  } else {
    // ponytail: one deployment lock; split only if independent channels need concurrency.
    const candidateLock = join(base, 'firebase-run.lock');
    mkdirSync(candidateLock);
    lock = candidateLock;
    const out = preparedOut || join(base, `firebase-${version}-${build}`);
    if (!preparedOut) mkdirSync(out, { mode: 0o700 });
    log = openSync(join(out, 'deployment.log'), 'a', 0o600);
    const source = join(out, 'source');
    if (!preparedOut) mkdirSync(source, { mode: 0o700 });
    stage = 'stage-source';
    if (!preparedOut) {
    run('rsync', ['-a', '--exclude=.git', '--exclude=node_modules', '--exclude=dist', '--exclude=dist-admin', '--exclude=.hermes', '--exclude=ios/App/Pods', '--exclude=ios/App/build', `${root}/`, `${source}/`]);
    }
    const env = { ...process.env, GOOGLE_APPLICATION_CREDENTIALS: credential, STOCKLY_TEST_DEVICE_UDID: c.testDeviceUdid, STOCKLY_BUILD_NUMBER: build, STOCKLY_ADHOC_DIR: out, STOCKLY_ADHOC_PROFILE: c.adHocProfileName, TMPDIR: join(home, '.hermes/cache/scratch') };
    delete env.FIREBASE_TOKEN;
    if (!preparedOut) {
    stage = 'install';
    run('npm', ['ci', '--prefer-offline'], source, env);
    stage = 'checks';
    run('node', ['--test', 'tests/low-stock-confirmation-preview.test.mjs'], source, env);
    run('npm', ['run', 'lint'], source, env);
    stage = 'archive-export';
    run('bash', ['scripts/ios-adhoc.sh'], source, env);
    }
    stage = 'artifact-validation';
    const ipa = join(out, 'export', readdirSync(join(out, 'export')).find(n => n.endsWith('.ipa')) || 'MISSING');
    run('python3', ['-c', `import sys,zipfile,plistlib,hashlib,pathlib
z=zipfile.ZipFile(sys.argv[1]); info=next(n for n in z.namelist() if n.startswith('Payload/') and n.endswith('.app/Info.plist') and n.count('/')==2); p=plistlib.loads(z.read(info)); assert p['CFBundleIdentifier']==sys.argv[2] and p['CFBundleVersion']==sys.argv[3]
chunks=[n for n in z.namelist() if '/public/assets/LowStockPage-' in n and n.endswith('.js')]; assert len(chunks)==1; data=z.read(chunks[0]); assert '발주 요청하는 품목이 맞는지 확인하세요'.encode() in data and '컨펌 체크한 품목'.encode() in data
name=chunks[0].split('/public/',1)[1]; staged=pathlib.Path(sys.argv[4])/'ios/App/App/public'/name; archived=next((pathlib.Path(sys.argv[5])/'Stockly-Dev.xcarchive/Products/Applications').glob('*.app'))/'public'/name; assert staged.read_bytes()==data and archived.read_bytes()==data
attendance=[n for n in z.namelist() if '/public/assets/AttendanceManagementPage-' in n and n.endswith('.js')]; assert len(attendance)==1; attendance_data=z.read(attendance[0]); assert '근무 요일 선택'.encode() in attendance_data and '요일 근무 시간 저장'.encode() in attendance_data and '추가 설정'.encode() in attendance_data
attendance_name=attendance[0].split('/public/',1)[1]; assert (pathlib.Path(sys.argv[4])/'ios/App/App/public'/attendance_name).read_bytes()==attendance_data and (next((pathlib.Path(sys.argv[5])/'Stockly-Dev.xcarchive/Products/Applications').glob('*.app'))/'public'/attendance_name).read_bytes()==attendance_data
print('IPA identity, UI markers and source/archive/IPA bytes verified')`, ipa, c.bundleId, build, source, out], source, env);
    writeFileSync(join(out, 'preparation.json'), JSON.stringify({ version, build }, null, 2), { mode: 0o600 });
    if (process.argv.includes('--prepare-only')) {
      console.log(JSON.stringify({ status: 'prepared', version, build, ipa, out }));
    } else {
    stage = 'firebase-upload';
    const since = new Date().toISOString();
    env.XDG_CONFIG_HOME = join(out, 'cli-config');
    env.CI = 'true';
    const notes = '근무 시간 설정을 직원 선택 → 월~일 요일 선택 → 출근·퇴근시간 입력으로 개선했습니다. 요일마다 다른 시간을 저장하고 기존 시간을 수정할 수 있습니다. 적용 시작일과 무급휴게는 추가 설정에 있습니다. Stockly Dev는 Mac 개발 서버 및 iPhone Tailscale/DNS 연결이 필요합니다.';
    const uploadOutput = execFileSync('firebase', ['appdistribution:distribute', ipa, '--app', c.firebaseAppId, '--groups', c.testerGroupAlias, '--project', c.firebaseProjectId, '--release-notes', notes], { cwd: source, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    writeFileSync(join(out, 'upload.log'), uploadOutput.replace(/https:\/\/\S+/g, '[URL REDACTED]'), { mode: 0o600 });
    stage = 'firebase-readback';
    const freshToken = await authenticate();
    const release = (await releases(freshToken)).find(r => r.displayVersion === version && r.buildVersion === build && Date.parse(r.createTime) >= Date.parse(since));
    if (!release) throw Error('New release not found after upload');
    const verified = await get(release.name, freshToken);
    if (verified.buildVersion !== build || verified.displayVersion !== version) throw Error('Release readback mismatch');
    const result = { status: 'success', app: 'Stockly Dev', bundleId: c.bundleId, version, build, firebaseRelease: verified.name, testerGroup: c.testerGroupAlias, testerCount: group.testerCount, testingUri: verified.testingUri, ipa, sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(), dirtySourceIncluded: true };
    const projectPath = join(root, 'ios/App/App.xcodeproj/project.pbxproj');
    const project = readFileSync(projectPath, 'utf8');
    const updatedProject = project.replace(/\t\t[0-9A-F]+ \/\* Debug \*\/ = \{[\s\S]*?\n\t\t\};/g, section => section.includes('PRODUCT_BUNDLE_IDENTIFIER = com.jinkim.stockly.dev;') ? section.replace(/CURRENT_PROJECT_VERSION = (\d+);/, (_, current) => `CURRENT_PROJECT_VERSION = ${Math.max(Number(current), Number(build))};`) : section);
    if (updatedProject !== project) writeFileSync(projectPath, updatedProject);
    writeFileSync(join(out, 'result.json'), JSON.stringify(result, null, 2));
    console.log(JSON.stringify(result));
    }
  }
} catch (error) {
  console.log(JSON.stringify({ status: stage === 'firebase-readback' ? 'unverified' : 'failed', stage, error: error.status !== undefined ? `Command exited ${error.status}; inspect deployment.log` : error.message }));
  process.exitCode = 1;
} finally {
  if (log) closeSync(log);
  if (lock) rmSync(lock, { recursive: true });
}
