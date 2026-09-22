import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { URL } from "node:url";
import test from "node:test";

const migrationUrl = new URL("../supabase/migrations/092_nfc_attendance_payroll.sql", import.meta.url);
const contractUrl = new URL("../supabase/tests/092_nfc_attendance_payroll_contract.sql", import.meta.url);

async function migration() {
  return readFile(migrationUrl, "utf8");
}

test("attendance migration keeps raw tokens out of storage and exposes secure RPCs", async () => {
  const sql = await migration();
  for (const required of [
    "attendance_management",
    "attendance_tags",
    "attendance_punch_events",
    "attendance_shifts",
    "attendance_pay_rates",
    "begin_attendance_punch",
    "finalize_attendance_punch",
    "get_my_pending_attendance_punch",
    "manage_attendance_shift",
    "security definer",
    "enable row level security",
    "digest(raw_token, 'sha256')",
    "request_id"
  ]) {
    assert.match(sql.toLowerCase(), new RegExp(required.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  assert.doesNotMatch(sql, /raw_token\s+text\s+(?:not\s+)?null/i);
});

test("shift approval is blocked until payroll rules are confirmed", async () => {
  const sql = await migration();
  assert.match(sql, /target_status\s*=\s*'approved'[\s\S]+attendance_payroll_rules[\s\S]+is_confirmed/i);
});

test("attendance migration separates immutable tag time from entered payroll time", async () => {
  const sql = await migration();
  assert.match(sql, /tagged_at\s+timestamptz/i);
  assert.match(sql, /entered_at\s+timestamptz/i);
  assert.match(sql, /confirmed_at\s+timestamptz/i);
  assert.match(sql, /attendance_shift_audit/i);
});

test("finalization qualifies its request id and is replay safe after completion", async () => {
  const sql = await migration();
  assert.match(sql, /finalize_request_id\s*=\s*finalize_attendance_punch\.request_id/i);
  assert.match(sql, /event\.finalize_request_id\s+is\s+distinct\s+from\s+finalize_attendance_punch\.request_id/i);
  assert.match(sql, /event\.status\s*=\s*'completed'[\s\S]+return\s+to_jsonb\(saved_shift\)/i);
});

test("pending punches expire and abnormal entered times are rejected", async () => {
  const sql = await migration();
  assert.match(sql, /expires_at\s+timestamptz\s+not\s+null/i);
  assert.match(sql, /'pending',\s*'completed',\s*'cancelled',\s*'expired'/i);
  assert.match(sql, /status\s*=\s*'expired'[\s\S]+expires_at\s*<=\s*clock_timestamp\(\)/i);
  assert.match(sql, /abs\s*\(\s*extract\s*\(\s*epoch[\s\S]+>\s*43200[\s\S]+raise exception/i);
});

test("server finalization time and store-scoped open shifts are used", async () => {
  const sql = await migration();
  assert.match(sql, /confirmed_at\s*=\s*clock_timestamp\(\)/i);
  assert.match(sql, /where\s+user_id\s*=\s*auth\.uid\(\)\s+and\s+store_id\s*=\s*event\.store_id\s+and\s+confirmed_check_out_at\s+is\s+null/i);
  assert.match(sql, /shift\.store_id\s*=\s*event\.store_id/i);
});

test("a day-off override suppresses the weekly schedule", async () => {
  const sql = await migration();
  assert.match(sql, /override\.is_day_off/i);
  assert.match(sql, /case\s+when\s+override\.is_day_off\s+then\s+null\s+else\s+coalesce\(override\.start_time,\s*weekly\.start_time\)\s+end/i);
});

test("holiday segments are store scoped, recurring, and split by local day", async () => {
  const sql = await migration();
  assert.match(sql, /store_closure_dates[\s\S]+closure\.store_id\s*=\s*item\.store_id/i);
  assert.match(sql, /weekly_store_closures[\s\S]+closure\.store_id\s*=\s*item\.store_id/i);
  assert.match(sql, /generate_series\([\s\S]+segment_day/i);
  assert.match(sql, /select 'holiday',\s*greatest\(item\.confirmed_check_in_at,\s*segment_day::timestamp[\s\S]+least\(paid_end,\s*\(segment_day \+ 1\)::timestamp/i);
});

test("segment recalculation is manager-only and shift edits reset every stale decision", async () => {
  const sql = await migration();
  assert.match(sql, /if\s+not\s+public\.attendance_manager\(item\.store_id\)\s+then\s+raise exception/i);
  assert.match(sql, /manage_attendance_shift[\s\S]+delete from public\.attendance_shift_segments[\s\S]+where shift_id = before_row\.id/i);
  assert.match(sql, /'shift_segment_reset'[\s\S]+'근무 수정으로 수당 구간 초기화:/i);
  assert.match(sql, /unpaid_break[\s\S]+extract\s*\(\s*epoch[\s\S]+raise exception/i);
  assert.match(sql, /target_status\s*=\s*'open'[\s\S]+confirmed_check_out\s+is\s+not\s+null/i);
});

test("weekly allowance is derived from effective rate and eligible worked minutes", async () => {
  const sql = await migration();
  assert.doesNotMatch(sql, /confirm_attendance_weekly_allowance\([\s\S]{0,250}target_allowance_amount/i);
  assert.match(sql, /confirm_attendance_weekly_allowance[\s\S]+eligible_minutes[\s\S]+weekly_contracted_minutes/i);
  assert.match(sql, /least\([\s\S]*weekly_contracted_minutes[\s\S]*300[\s\S]*8/i);
  assert.match(sql, /allowance_amount[\s\S]+hourly_wage/i);
});

test("pending prompt shape includes schedule suggestions and replay uses the same builder", async () => {
  const sql = await migration();
  assert.match(sql, /'scheduled_time'[\s\S]+'suggested_time'[\s\S]+'tag_name'[\s\S]+'open_check_in_at'/i);
  assert.match(sql, /attendance_schedule_overrides[\s\S]+coalesce\(override\.start_time,\s*weekly\.start_time\)/i);
  assert.doesNotMatch(sql, /pending\.id\s+is\s+not\s+null\s+then\s+return\s+to_jsonb\(pending\)/i);
});

test("NFC tags can be securely rotated without retaining the replacement token", async () => {
  const sql = await migration();
  assert.match(sql, /create or replace function public\.rotate_attendance_tag\(target_tag_id uuid,\s*change_reason text\)/i);
  assert.match(sql, /update public\.attendance_tags set token_hash\s*=\s*encode\(digest\(raw_token,\s*'sha256'\)/i);
  assert.match(sql, /jsonb_build_object\([\s\S]+'token',\s*raw_token[\s\S]+'url'/i);
});

test("premium segments use paid time, effective Seoul-date rules and deterministic rounding", async () => {
  const sql = await migration();
  assert.match(sql, /weekly_overtime_threshold_minutes\s+integer/i);
  assert.match(sql, /paid_end\s*:=\s*item\.confirmed_check_out_at\s*-\s*make_interval\(mins\s*=>\s*item\.unpaid_break_minutes\)/i);
  assert.match(sql, /work_date\s*:=\s*\(item\.confirmed_check_in_at\s+at time zone 'Asia\/Seoul'\)::date/i);
  assert.match(sql, /prior_paid_minutes[\s\S]+weekly_overtime_threshold_minutes/i);
  assert.match(sql, /holiday[\s\S]+480/i);
  assert.match(sql, /case\s+rule\.rounding_rule[\s\S]+when\s+'floor'[\s\S]+when\s+'ceil'/i);
});

test("every SECURITY DEFINER function pins pg_catalog, public, and pg_temp", async () => {
  const sql = await migration();
  const definitions = [...sql.matchAll(/create or replace function[\s\S]+?\$\$;/gi)].map((match) => match[0]);
  const definers = definitions.filter((definition) => /security definer/i.test(definition));
  assert.ok(definers.length > 10);
  for (const definition of definers) assert.match(definition, /set search_path\s*=\s*pg_catalog,\s*public,\s*pg_temp/i);
});

test("management tables are RPC-only and related rows are store validated", async () => {
  const sql = await migration();
  assert.doesNotMatch(sql, /policy\s+"[^"]*manage[^"]*"\s+on\s+public\.attendance_(?:work_schedules|schedule_overrides|pay_rates|payroll_rules|shift_segments|weekly_allowances)\s+for all/i);
  assert.doesNotMatch(sql, /grant select, insert, update, delete on public\.attendance_/i);
  for (const rpc of [
    "save_attendance_work_schedule",
    "save_attendance_schedule_override",
    "save_attendance_pay_rate",
    "save_attendance_payroll_rules",
    "confirm_attendance_segments",
    "confirm_attendance_weekly_allowance",
    "rotate_attendance_tag"
  ]) {
    assert.match(sql, new RegExp(`create or replace function public\\.${rpc}\\([\\s\\S]+security definer`, "i"));
  }
  assert.match(sql, /target_user_id[\s\S]+profiles[\s\S]+store_id\s*=\s*caller_store/i);
  assert.match(sql, /target_shift_id[\s\S]+attendance_shifts[\s\S]+store_id\s*=\s*caller_store/i);
  assert.match(sql, /save_attendance_work_schedule[\s\S]+change_reason[\s\S]+audit_attendance_management/i);
  assert.match(sql, /confirm_attendance_segments[\s\S]+nullif\(btrim\(change_reason\),\s*''\)/i);
});

test("attendance references cannot cross stores", async () => {
  const sql = await migration();
  for (const relation of ["attendance_tags", "attendance_punch_events", "attendance_shifts"]) {
    assert.match(sql, new RegExp(`foreign key \\(.*store_id.*\\) references public\\.${relation} \\(`, "i"));
  }
  assert.match(sql, /foreign key \(user_id, store_id\) references public\.profiles \(id, store_id\)/i);
});

test("pay rates and rules are effective dated integer-won contracts", async () => {
  const sql = await migration();
  assert.match(sql, /hourly_wage\s+bigint[^,]+check\s*\(hourly_wage\s*>=\s*0\)/i);
  assert.match(sql, /weekly_contracted_minutes\s+integer/i);
  assert.match(sql, /attendance_pay_rates[\s\S]+effective_to\s+date/i);
  assert.match(sql, /attendance_payroll_rules[\s\S]+effective_from\s+date[\s\S]+effective_to\s+date/i);
  assert.match(sql, /rounding_rule\s+text[\s\S]+rounding_version\s+integer/i);
  assert.match(sql, /exclude using gist[\s\S]+daterange/i);
});

test("new stores receive a default payroll rule", async () => {
  const sql = await migration();
  assert.match(sql, /after insert on public\.stores[\s\S]+attendance_payroll_rules/i);
});

test("SQL contract checks exact SQLSTATE values", async () => {
  const sql = await readFile(contractUrl, "utf8");
  assert.match(sql, /get stacked diagnostics[\s\S]+returned_sqlstate/i);
  assert.match(sql, /caught_sqlstate\s*(?:<>|is distinct from)\s*'42501'/i);
  assert.doesNotMatch(sql, /exception\s+when\s+others\s+then[\s\S]{0,250}sqlerrm\s*=/i);
});
