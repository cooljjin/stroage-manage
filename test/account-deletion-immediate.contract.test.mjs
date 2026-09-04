import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const root = new globalThis.URL("..", import.meta.url);
const read = (path) => readFile(new globalThis.URL(path, root), "utf8");

test("sole legacy-store admin can request deletion without a transfer target", async () => {
  const [section, functionSource] = await Promise.all([
    read("src/components/AccountDeletionSection.tsx"),
    read("supabase/functions/manage-account-deletion/index.ts")
  ]);

  assert.match(section, /매장 이관 없이 탈퇴/);
  assert.match(functionSource, /"without_transfer"/);
  assert.match(functionSource, /\(members \?\? \[\]\)\.length === 0/);
  assert.match(functionSource, /store\.created_by === profile\.id \? "personal" : "without_transfer"/);
});

test("pending deletion recovery offers a verified immediate account deletion action", async () => {
  const [recovery, functionSource] = await Promise.all([
    read("src/pages/AccountDeletionRecoveryPage.tsx"),
    read("supabase/functions/manage-account-deletion/index.ts")
  ]);

  assert.match(recovery, /바로 계정 삭제/);
  assert.match(recovery, /바로 삭제하면 매장 데이터와 계정이 영구 삭제되며 복구할 수 없습니다\./);
  assert.doesNotMatch(recovery, /Supabase 계정/);
  assert.match(recovery, /action:\s*"delete_now"/);
  assert.match(functionSource, /body\.action === "delete_now"/);
  assert.match(functionSource, /auth\.admin\.deleteUser\(userId\)/);
  assert.match(functionSource, /auth\.admin\.getUserById\(userId\)/);
  assert.match(functionSource, /계정 삭제를 확인하지 못했습니다/);
});
