import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { URL } from 'node:url';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import { transpileModule } from 'typescript';

const source = await readFile(new URL('../src/pages/AttendanceManagementPage.tsx', import.meta.url), 'utf8');
const handler = source.slice(source.indexOf('  async function deleteShift('), source.indexOf('  async function setSegmentStatus('));
function fixture({ reason = '잘못된 기록', confirm = true, error = null, throws = false } = {}) {
  const state = { saving: false, selected: true, dayOpen: true, detailKey: 'actual-shift', reloads: 0, calls: [], error: '', message: '' };
  const context = {
    saving: false, currentStoreId: 'store', staffById: new Map([['employee', { display_name: '테스트 직원' }]]),
    formatDateTime: () => '10/07 21:00', window: { prompt: () => reason, confirm: () => confirm },
    setSaving: value => { state.saving = value; }, setError: value => { state.error = value; }, setMessage: value => { state.message = value; },
    setSelectedShift: value => { state.selected = value; }, setDayOpen: value => { state.dayOpen = value; }, setDetailKey: value => { state.detailKey = value; },
    loadData: async () => { state.reloads++; },
    Services: { DatabaseService: { rpc: async (name, args) => { state.calls.push({ name, args }); if (throws) throw new Error('네트워크 오류'); return { error }; } } }
  };
  runInNewContext(transpileModule(handler, {}).outputText, context);
  return { state, run: (store = 'store') => context.deleteShift({ id: 'shift', store_id: store, user_id: 'employee', confirmed_check_in_at: '2026-10-07T12:00:00Z' }) };
}

test('cancelled confirmation, missing reason and mismatched store never delete', async () => {
  for (const options of [{ reason: null }, { reason: '  ' }, { confirm: false }]) {
    const f = fixture(options); await f.run(); assert.equal(f.state.calls.length, 0); assert.equal(f.state.selected, true);
  }
  const f = fixture(); await f.run('other-store'); assert.equal(f.state.calls.length, 0);
});
test('successful deletion uses scoped RPC then closes detail and refreshes totals', async () => {
  const f = fixture(); await f.run();
  assert.equal(f.state.calls.length, 1); assert.equal(f.state.calls[0].name, 'delete_attendance_shift');
  assert.equal(f.state.calls[0].args.target_store_id, 'store'); assert.equal(f.state.calls[0].args.target_shift_id, 'shift');
  assert.equal(f.state.selected, null); assert.equal(f.state.dayOpen, false); assert.equal(f.state.detailKey, null);
  assert.equal(f.state.reloads, 1); assert.equal(f.state.saving, false); assert.match(f.state.message, /삭제했습니다/);
});
test('RPC and network errors retain the record and release the busy state', async () => {
  for (const options of [{ error: { code: '42501', message: '권한 없음' } }, { throws: true }]) {
    const f = fixture(options); await f.run(); assert.equal(f.state.selected, true); assert.equal(f.state.dayOpen, true);
    assert.equal(f.state.reloads, 0); assert.equal(f.state.saving, false); assert.ok(f.state.error);
  }
});
test('missing server migration gives a database-update message without closing the form', async () => {
  const f = fixture({ error: { code: 'PGRST202', message: 'missing function' } }); await f.run();
  assert.equal(f.state.error, '데이터베이스 업데이트가 필요합니다.'); assert.equal(f.state.selected, true);
});
