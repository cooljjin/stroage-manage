import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import process from 'node:process';
import test from 'node:test';
const script = readFileSync('scripts/ios-adhoc.sh','utf8');
const exportCode = script.match(/python3 - "\$options" <<'PY'\n([\s\S]*?)\nPY/)?.[1];
assert.ok(exportCode);
for (const profile of ['', 'Stockly Dev NFC Ad Hoc']) {
  test(`Ad Hoc export uses ${profile ? 'the exact manual profile' : 'automatic signing by default'}`, () => {
    const dir = mkdtempSync(join(process.env.TMPDIR, 'stockly-export-check-'));
    try {
      const out = join(dir,'ExportOptions.plist');
      execFileSync('python3',['-c',exportCode,out],{env:{...process.env,STOCKLY_ADHOC_PROFILE:profile}});
      const parsed = JSON.parse(execFileSync('python3',['-c','import plistlib,json,sys; print(json.dumps(plistlib.load(open(sys.argv[1],"rb"))))',out],{encoding:'utf8'}));
      assert.equal(parsed.method,'release-testing');
      assert.equal(parsed.teamID,'RQMBNM7XVV');
      assert.equal(parsed.manageAppVersionAndBuildNumber,false);
      assert.equal(parsed.signingStyle,profile?'manual':'automatic');
      if(profile) assert.deepEqual(parsed.provisioningProfiles,{'com.jinkim.stockly.dev':profile});
    } finally { rmSync(dir,{recursive:true}); }
  });
}
