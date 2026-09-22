create extension if not exists pgcrypto;
create extension if not exists btree_gist;

alter table public.staff_permissions drop constraint if exists staff_permissions_permission_key_check;
alter table public.staff_permissions add constraint staff_permissions_permission_key_check check (permission_key in (
  'category_management', 'supplier_management', 'group_order_recipe_management',
  'order_confirmation', 'attendance_management'
));

create unique index if not exists profiles_id_store_unique on public.profiles (id, store_id);

create table public.attendance_tags (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 80),
  token_hash text not null unique check (char_length(token_hash) = 64),
  is_active boolean not null default true,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, store_id)
);

create table public.attendance_work_schedules (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  user_id uuid not null,
  weekday smallint not null check (weekday between 0 and 6),
  start_time time not null,
  end_time time not null,
  unpaid_break_minutes integer not null default 0 check (unpaid_break_minutes between 0 and 720),
  effective_from date not null,
  effective_to date,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  foreign key (user_id, store_id) references public.profiles (id, store_id) on delete cascade,
  check (effective_to is null or effective_to >= effective_from),
  unique (store_id, user_id, weekday, effective_from),
  exclude using gist (
    store_id with =, user_id with =, weekday with =,
    daterange(effective_from, coalesce(effective_to, 'infinity'::date), '[]') with &&
  )
);

create table public.attendance_schedule_overrides (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  user_id uuid not null,
  work_date date not null,
  is_day_off boolean not null default false,
  start_time time,
  end_time time,
  unpaid_break_minutes integer not null default 0 check (unpaid_break_minutes between 0 and 720),
  note text,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  foreign key (user_id, store_id) references public.profiles (id, store_id) on delete cascade,
  check ((is_day_off and start_time is null and end_time is null) or (not is_day_off and start_time is not null and end_time is not null)),
  unique (store_id, user_id, work_date)
);

create table public.attendance_pay_rates (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  user_id uuid not null,
  hourly_wage bigint not null check (hourly_wage >= 0),
  weekly_contracted_minutes integer not null check (weekly_contracted_minutes between 0 and 10080),
  effective_from date not null,
  effective_to date,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  foreign key (user_id, store_id) references public.profiles (id, store_id) on delete cascade,
  check (effective_to is null or effective_to >= effective_from),
  unique (store_id, user_id, effective_from),
  exclude using gist (
    store_id with =, user_id with =,
    daterange(effective_from, coalesce(effective_to, 'infinity'::date), '[]') with &&
  )
);

create table public.attendance_payroll_rules (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  effective_from date not null default current_date,
  effective_to date,
  overtime_multiplier numeric(5,2) not null default 0.5 check (overtime_multiplier >= 0),
  night_multiplier numeric(5,2) not null default 0.5 check (night_multiplier >= 0),
  holiday_multiplier numeric(5,2) not null default 0.5 check (holiday_multiplier >= 0),
  weekly_threshold_minutes integer not null default 900 check (weekly_threshold_minutes >= 0),
  weekly_overtime_threshold_minutes integer not null default 2400 check (weekly_overtime_threshold_minutes >= 0),
  rounding_rule text not null default 'half_up' check (rounding_rule in ('half_up', 'floor', 'ceil')),
  rounding_version integer not null default 1 check (rounding_version > 0),
  is_confirmed boolean not null default false,
  updated_by uuid references auth.users(id),
  updated_at timestamptz not null default now(),
  check (effective_to is null or effective_to >= effective_from),
  unique (store_id, effective_from),
  exclude using gist (
    store_id with =,
    daterange(effective_from, coalesce(effective_to, 'infinity'::date), '[]') with &&
  )
);

insert into public.attendance_payroll_rules (store_id)
select id from public.stores on conflict (store_id, effective_from) do nothing;

create or replace function public.create_default_attendance_payroll_rule()
returns trigger language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
begin
  insert into public.attendance_payroll_rules (store_id, effective_from)
  values (new.id, current_date)
  on conflict (store_id, effective_from) do nothing;
  return new;
end;
$$;

create trigger create_attendance_payroll_rule_for_store
after insert on public.stores
for each row execute function public.create_default_attendance_payroll_rule();

create table public.attendance_punch_events (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  user_id uuid not null,
  tag_id uuid not null,
  punch_type text not null check (punch_type in ('check_in', 'check_out')),
  tagged_at timestamptz not null default clock_timestamp(),
  entered_at timestamptz,
  confirmed_at timestamptz,
  expires_at timestamptz not null default (clock_timestamp() + interval '15 minutes'),
  status text not null default 'pending' check (status in ('pending', 'completed', 'cancelled', 'expired')),
  request_id uuid not null,
  finalize_request_id uuid,
  needs_review boolean not null default false,
  created_at timestamptz not null default now(),
  foreign key (user_id, store_id) references public.profiles (id, store_id) on delete cascade,
  foreign key (tag_id, store_id) references public.attendance_tags (id, store_id),
  unique (id, user_id, store_id),
  unique (user_id, request_id),
  unique (user_id, finalize_request_id)
);

create unique index attendance_one_pending_per_user_idx
on public.attendance_punch_events (user_id) where status = 'pending';

create table public.attendance_shifts (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  user_id uuid not null,
  check_in_event_id uuid not null unique,
  check_out_event_id uuid unique,
  scheduled_start_at timestamptz,
  scheduled_end_at timestamptz,
  entered_check_in_at timestamptz not null,
  entered_check_out_at timestamptz,
  confirmed_check_in_at timestamptz not null,
  confirmed_check_out_at timestamptz,
  unpaid_break_minutes integer not null default 0 check (unpaid_break_minutes between 0 and 720),
  status text not null default 'open' check (status in ('open', 'closed', 'needs_review', 'approved')),
  manager_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (user_id, store_id) references public.profiles (id, store_id) on delete cascade,
  foreign key (check_in_event_id, user_id, store_id) references public.attendance_punch_events (id, user_id, store_id),
  foreign key (check_out_event_id, user_id, store_id) references public.attendance_punch_events (id, user_id, store_id),
  unique (id, store_id),
  check (confirmed_check_out_at is null or confirmed_check_out_at > confirmed_check_in_at)
);

create unique index attendance_one_open_shift_per_user_idx
on public.attendance_shifts (user_id) where confirmed_check_out_at is null;
create index attendance_shifts_store_range_idx on public.attendance_shifts (store_id, confirmed_check_in_at desc);

create table public.attendance_shift_segments (
  id uuid primary key default gen_random_uuid(),
  shift_id uuid not null,
  store_id uuid not null references public.stores(id) on delete cascade,
  segment_type text not null check (segment_type in ('schedule_overrun', 'overtime', 'night', 'holiday')),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  status text not null default 'candidate' check (status in ('candidate', 'confirmed', 'rejected')),
  confirmed_by uuid references auth.users(id),
  confirmed_at timestamptz,
  pay_rate_id uuid references public.attendance_pay_rates(id),
  payroll_rule_id uuid references public.attendance_payroll_rules(id),
  premium_amount bigint not null default 0 check (premium_amount >= 0),
  created_at timestamptz not null default now(),
  foreign key (shift_id, store_id) references public.attendance_shifts (id, store_id) on delete cascade,
  check (ends_at > starts_at),
  unique (shift_id, segment_type, starts_at, ends_at)
);

create index attendance_segments_shift_idx on public.attendance_shift_segments (shift_id, segment_type);

create table public.attendance_weekly_allowances (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  user_id uuid not null,
  week_start date not null,
  eligible boolean not null,
  allowance_amount bigint not null default 0 check (allowance_amount >= 0),
  confirmed_by uuid not null references auth.users(id),
  confirmed_at timestamptz not null default clock_timestamp(),
  note text,
  foreign key (user_id, store_id) references public.profiles (id, store_id) on delete cascade,
  unique (store_id, user_id, week_start)
);

create table public.attendance_shift_audit (
  id uuid primary key default gen_random_uuid(),
  shift_id uuid not null,
  store_id uuid not null references public.stores(id) on delete cascade,
  changed_by uuid not null references auth.users(id),
  reason text not null check (char_length(btrim(reason)) between 1 and 500),
  before_values jsonb not null,
  after_values jsonb not null,
  created_at timestamptz not null default clock_timestamp(),
  foreign key (shift_id, store_id) references public.attendance_shifts (id, store_id) on delete cascade
);

create table public.attendance_management_audit (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  entity_type text not null,
  entity_id uuid not null,
  changed_by uuid not null references auth.users(id),
  reason text not null check (char_length(btrim(reason)) between 1 and 500),
  before_values jsonb,
  after_values jsonb,
  created_at timestamptz not null default clock_timestamp()
);

create or replace function public.attendance_manager(target_store_id uuid)
returns boolean language sql stable security definer set search_path = pg_catalog, public, pg_temp as $$
  select public.can_manage_store_task(target_store_id, 'attendance_management');
$$;

create or replace function public.prevent_attendance_event_mutation()
returns trigger language plpgsql as $$
begin
  if new.tagged_at <> old.tagged_at or new.store_id <> old.store_id or new.user_id <> old.user_id
    or new.tag_id <> old.tag_id or new.punch_type <> old.punch_type or new.request_id <> old.request_id
    or new.expires_at <> old.expires_at then
    raise exception using errcode = '42501', message = '원본 NFC 태그 기록은 변경할 수 없습니다.';
  end if;
  return new;
end;
$$;

create trigger attendance_punch_event_immutable
before update on public.attendance_punch_events
for each row execute function public.prevent_attendance_event_mutation();

create or replace function public.audit_attendance_management(
  target_store_id uuid, target_entity_type text, target_entity_id uuid,
  change_reason text, before_values jsonb, after_values jsonb
) returns void language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
begin
  if not public.attendance_manager(target_store_id) or nullif(btrim(change_reason), '') is null then
    raise exception using errcode = '42501', message = '근태관리 권한과 변경 사유가 필요합니다.';
  end if;
  insert into public.attendance_management_audit
    (store_id, entity_type, entity_id, changed_by, reason, before_values, after_values)
  values
    (target_store_id, target_entity_type, target_entity_id, auth.uid(), btrim(change_reason), before_values, after_values);
end;
$$;

create or replace function public.create_attendance_tag(tag_name text)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
declare
  caller_store uuid;
  raw_token text := encode(gen_random_bytes(32), 'base64');
  created_tag public.attendance_tags;
begin
  select store_id into caller_store from public.profiles where id = auth.uid();
  if caller_store is null or not public.attendance_manager(caller_store) then
    raise exception using errcode = '42501', message = '근태관리 권한이 필요합니다.';
  end if;
  if nullif(btrim(tag_name), '') is null then raise exception using errcode = '22023', message = '태그 이름이 필요합니다.'; end if;
  raw_token := replace(replace(replace(raw_token, '+', '-'), '/', '_'), '=', '');
  insert into public.attendance_tags (store_id, name, token_hash, created_by)
  values (caller_store, btrim(tag_name), encode(digest(raw_token, 'sha256'), 'hex'), auth.uid()) returning * into created_tag;
  perform public.audit_attendance_management(caller_store, 'tag', created_tag.id, 'NFC 태그 생성', null, to_jsonb(created_tag));
  return jsonb_build_object('id', created_tag.id, 'name', created_tag.name, 'token', raw_token, 'created_at', created_tag.created_at);
end;
$$;

create or replace function public.update_attendance_tag(target_tag_id uuid, tag_name text, active boolean)
returns public.attendance_tags language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
declare before_row public.attendance_tags; changed public.attendance_tags;
begin
  select * into before_row from public.attendance_tags where id = target_tag_id for update;
  if before_row.id is null or not public.attendance_manager(before_row.store_id) then
    raise exception using errcode = '42501', message = '태그를 찾을 수 없거나 권한이 없습니다.';
  end if;
  if nullif(btrim(tag_name), '') is null or active is null then raise exception using errcode = '22023', message = '태그 이름과 상태가 필요합니다.'; end if;
  update public.attendance_tags set name = btrim(tag_name), is_active = active, updated_at = clock_timestamp()
  where id = target_tag_id returning * into changed;
  perform public.audit_attendance_management(changed.store_id, 'tag', changed.id, 'NFC 태그 수정', to_jsonb(before_row), to_jsonb(changed));
  return changed;
end;
$$;

create or replace function public.rotate_attendance_tag(target_tag_id uuid, change_reason text)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
declare
  before_row public.attendance_tags;
  changed public.attendance_tags;
  raw_token text := replace(replace(replace(encode(gen_random_bytes(32), 'base64'), '+', '-'), '/', '_'), '=', '');
begin
  select * into before_row from public.attendance_tags where id = target_tag_id for update;
  if before_row.id is null or not public.attendance_manager(before_row.store_id) then
    raise exception using errcode = '42501', message = '태그를 찾을 수 없거나 권한이 없습니다.';
  end if;
  if nullif(btrim(change_reason), '') is null then raise exception using errcode = '22023', message = '재발급 사유가 필요합니다.'; end if;
  update public.attendance_tags set token_hash = encode(digest(raw_token, 'sha256'), 'hex'), is_active = true,
    updated_at = clock_timestamp()
  where id = before_row.id returning * into changed;
  perform public.audit_attendance_management(changed.store_id, 'tag', changed.id, change_reason, to_jsonb(before_row), to_jsonb(changed));
  return jsonb_build_object('id', changed.id, 'name', changed.name, 'token', raw_token,
    'url', '/attendance/tag/' || raw_token, 'created_at', changed.updated_at);
end;
$$;

create or replace function public.attendance_punch_prompt(target_event_id uuid)
returns jsonb language sql stable security definer set search_path = pg_catalog, public, pg_temp as $$
  select jsonb_build_object(
    'id', event.id, 'punch_type', event.punch_type, 'tagged_at', event.tagged_at,
    'expires_at', event.expires_at, 'status', event.status, 'store_id', event.store_id,
    'scheduled_time', case
      when event.punch_type = 'check_out' then to_char(shift.scheduled_end_at at time zone 'Asia/Seoul', 'HH24:MI')
      when override.is_day_off then null
      else to_char(coalesce(override.start_time, weekly.start_time), 'HH24:MI')
    end,
    'suggested_time', case
      when event.punch_type = 'check_out' then to_char(shift.scheduled_end_at at time zone 'Asia/Seoul', 'HH24:MI')
      when override.is_day_off then null
      else to_char(coalesce(override.start_time, weekly.start_time), 'HH24:MI')
    end,
    'tag_name', tag.name, 'open_check_in_at', shift.confirmed_check_in_at,
    'warning_message', null
  )
  from public.attendance_punch_events event
  join public.attendance_tags tag on tag.id = event.tag_id and tag.store_id = event.store_id
  left join public.attendance_shifts shift on shift.user_id = event.user_id
    and shift.store_id = event.store_id and shift.confirmed_check_out_at is null
  left join lateral (
    select item.is_day_off, item.start_time from public.attendance_schedule_overrides item
    where item.store_id = event.store_id and item.user_id = event.user_id
      and item.work_date = (event.tagged_at at time zone 'Asia/Seoul')::date limit 1
  ) override on true
  left join lateral (
    select item.start_time from public.attendance_work_schedules item
    where item.store_id = event.store_id and item.user_id = event.user_id
      and item.weekday = extract(dow from (event.tagged_at at time zone 'Asia/Seoul')::date)::integer
      and item.effective_from <= (event.tagged_at at time zone 'Asia/Seoul')::date
      and (item.effective_to is null or item.effective_to >= (event.tagged_at at time zone 'Asia/Seoul')::date)
    order by item.effective_from desc limit 1
  ) weekly on true
  where event.id = target_event_id and event.user_id = auth.uid();
$$;

create or replace function public.get_my_pending_attendance_punch()
returns jsonb language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
declare pending_id uuid;
begin
  update public.attendance_punch_events
  set status = 'expired'
  where user_id = auth.uid() and status = 'pending' and expires_at <= clock_timestamp();

  select event.id into pending_id from public.attendance_punch_events event
  where event.user_id = auth.uid() and event.status = 'pending'
  order by event.created_at desc limit 1;
  return coalesce(public.attendance_punch_prompt(pending_id), 'null'::jsonb);
end;
$$;

create or replace function public.begin_attendance_punch(raw_token text, request_id uuid)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
declare
  caller_profile public.profiles;
  matched_tag public.attendance_tags;
  pending public.attendance_punch_events;
  kind text;
begin
  if request_id is null or raw_token is null or char_length(raw_token) < 3 then
    raise exception using errcode = '22023', message = '유효하지 않은 태그 요청입니다.';
  end if;
  select * into caller_profile from public.profiles where id = auth.uid();
  if caller_profile.id is null then raise exception using errcode = '42501', message = '로그인이 필요합니다.'; end if;

  select * into matched_tag from public.attendance_tags
  where token_hash = encode(digest(raw_token, 'sha256'), 'hex') and is_active and store_id = caller_profile.store_id;
  if matched_tag.id is null then raise exception using errcode = '42501', message = '이 매장에 등록된 활성 NFC 태그가 아닙니다.'; end if;

  update public.attendance_punch_events set status = 'expired'
  where user_id = auth.uid() and status = 'pending' and expires_at <= clock_timestamp();

  select * into pending from public.attendance_punch_events
  where user_id = auth.uid() and attendance_punch_events.request_id = begin_attendance_punch.request_id;
  if pending.id is not null then return public.attendance_punch_prompt(pending.id); end if;

  select * into pending from public.attendance_punch_events
  where user_id = auth.uid() and status = 'pending' order by created_at desc limit 1;
  if pending.id is not null then return public.get_my_pending_attendance_punch(); end if;

  if exists (
    select 1 from public.attendance_shifts
    where user_id = auth.uid() and store_id = caller_profile.store_id and confirmed_check_out_at is null
  ) then kind := 'check_out'; else kind := 'check_in'; end if;

  insert into public.attendance_punch_events (store_id, user_id, tag_id, punch_type, request_id)
  values (matched_tag.store_id, auth.uid(), matched_tag.id, kind, request_id);
  return public.get_my_pending_attendance_punch();
exception when unique_violation then
  select * into pending from public.attendance_punch_events
  where user_id = auth.uid() and attendance_punch_events.request_id = begin_attendance_punch.request_id;
  return coalesce(public.attendance_punch_prompt(pending.id), public.get_my_pending_attendance_punch());
end;
$$;

create or replace function public.refresh_attendance_segments(target_shift_id uuid)
returns void language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
declare
  item public.attendance_shifts;
  rate public.attendance_pay_rates;
  rule public.attendance_payroll_rules;
  candidate record;
  work_date date;
  week_start date;
  paid_end timestamptz;
  overtime_start timestamptz;
  prior_paid_minutes numeric := 0;
  multiplier numeric;
  raw_amount numeric;
  rounded_amount bigint;
begin
  select * into item from public.attendance_shifts where id = target_shift_id;
  if item.id is null or item.confirmed_check_out_at is null then return; end if;

  work_date := (item.confirmed_check_in_at at time zone 'Asia/Seoul')::date;
  week_start := work_date - (extract(isodow from work_date)::integer - 1);
  -- ponytail: until timed breaks are captured, the unpaid interval is deterministically the shift's final N minutes.
  paid_end := item.confirmed_check_out_at - make_interval(mins => item.unpaid_break_minutes);
  if paid_end <= item.confirmed_check_in_at then return; end if;

  select * into rate from public.attendance_pay_rates
  where store_id = item.store_id and user_id = item.user_id and effective_from <= work_date
    and (effective_to is null or effective_to >= work_date)
  order by effective_from desc limit 1;
  select * into rule from public.attendance_payroll_rules
  where store_id = item.store_id and effective_from <= work_date
    and (effective_to is null or effective_to >= work_date)
  order by effective_from desc limit 1;

  select coalesce(sum(greatest(0, extract(epoch from
    ((prior.confirmed_check_out_at - make_interval(mins => prior.unpaid_break_minutes)) - prior.confirmed_check_in_at)) / 60)), 0)
  into prior_paid_minutes
  from public.attendance_shifts prior
  where prior.store_id = item.store_id and prior.user_id = item.user_id and prior.id <> item.id
    and prior.confirmed_check_out_at is not null and prior.confirmed_check_in_at < item.confirmed_check_in_at
    and (prior.confirmed_check_in_at at time zone 'Asia/Seoul')::date between week_start and week_start + 6;

  -- Daily/holiday work beyond 8 hours and work crossing the configured weekly threshold share one overtime segment.
  overtime_start := least(
    item.confirmed_check_in_at + interval '480 minutes',
    item.confirmed_check_in_at + make_interval(mins => greatest(0,
      coalesce(rule.weekly_overtime_threshold_minutes, 2400) - prior_paid_minutes)::integer)
  );

  delete from public.attendance_shift_segments where shift_id = item.id and status = 'candidate';

  for candidate in
    with bounds as (
      select item.confirmed_check_in_at as starts_at, paid_end as ends_at
    ), days as (
      select day::date as segment_day
      from generate_series(
        (item.confirmed_check_in_at at time zone 'Asia/Seoul')::date - 1,
        (paid_end at time zone 'Asia/Seoul')::date,
        interval '1 day'
      ) day
    ), candidates(segment_type, starts_at, ends_at) as (
      select 'schedule_overrun', item.confirmed_check_in_at, least(paid_end, item.scheduled_start_at)
      where item.scheduled_start_at is not null and item.confirmed_check_in_at < least(paid_end, item.scheduled_start_at)
      union all
      select 'schedule_overrun', greatest(item.confirmed_check_in_at, item.scheduled_end_at), paid_end
      where item.scheduled_end_at is not null and paid_end > greatest(item.confirmed_check_in_at, item.scheduled_end_at)
      union all
      select 'overtime', overtime_start, paid_end where paid_end > overtime_start
      union all
      select 'night', greatest(item.confirmed_check_in_at, (segment_day + time '22:00') at time zone 'Asia/Seoul'),
        least(paid_end, ((segment_day + 1) + time '06:00') at time zone 'Asia/Seoul') from days
      union all
      select 'holiday', greatest(item.confirmed_check_in_at, segment_day::timestamp at time zone 'Asia/Seoul'),
        least(paid_end, (segment_day + 1)::timestamp at time zone 'Asia/Seoul') from days
      where exists (select 1 from public.store_closure_dates closure
          where closure.store_id = item.store_id and closure.closure_date = segment_day)
        or exists (select 1 from public.weekly_store_closures closure
          where closure.store_id = item.store_id and closure.weekday = extract(dow from segment_day)::smallint)
    )
    select segment_type, starts_at, ends_at from candidates where ends_at > starts_at
  loop
    multiplier := case candidate.segment_type
      when 'overtime' then coalesce(rule.overtime_multiplier, 0)
      when 'night' then coalesce(rule.night_multiplier, 0)
      when 'holiday' then coalesce(rule.holiday_multiplier, 0)
      else 0 end;
    raw_amount := extract(epoch from (candidate.ends_at - candidate.starts_at)) / 3600
      * coalesce(rate.hourly_wage, 0) * multiplier;
    rounded_amount := case rule.rounding_rule
      when 'floor' then floor(raw_amount)
      when 'ceil' then ceil(raw_amount)
      else round(raw_amount) end;
    insert into public.attendance_shift_segments
      (shift_id, store_id, segment_type, starts_at, ends_at, pay_rate_id, payroll_rule_id, premium_amount)
    values
      (item.id, item.store_id, candidate.segment_type, candidate.starts_at, candidate.ends_at,
       rate.id, rule.id, rounded_amount)
    on conflict (shift_id, segment_type, starts_at, ends_at) do nothing;
  end loop;
end;
$$;

create or replace function public.recalculate_attendance_segments(target_shift_id uuid)
returns void language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
declare item public.attendance_shifts; before_segments jsonb;
begin
  select * into item from public.attendance_shifts where id = target_shift_id;
  if item.id is null then raise exception using errcode = 'P0002', message = '근무 기록을 찾을 수 없습니다.'; end if;
  if not public.attendance_manager(item.store_id) then raise exception using errcode = '42501', message = '근태관리 권한이 필요합니다.'; end if;
  select coalesce(jsonb_agg(to_jsonb(segment) order by segment.starts_at), '[]'::jsonb)
  into before_segments from public.attendance_shift_segments segment where segment.shift_id = item.id;
  perform public.refresh_attendance_segments(item.id);
  perform public.audit_attendance_management(
    item.store_id, 'shift_segments', item.id, '수당 구간 재계산', before_segments,
    (select coalesce(jsonb_agg(to_jsonb(segment) order by segment.starts_at), '[]'::jsonb)
     from public.attendance_shift_segments segment where segment.shift_id = item.id)
  );
end;
$$;

create or replace function public.finalize_attendance_punch(target_event_id uuid, entered_time time, request_id uuid)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
declare
  event public.attendance_punch_events;
  open_shift public.attendance_shifts;
  saved_shift public.attendance_shifts;
  local_date date;
  entered_timestamp timestamptz;
  schedule_start time;
  schedule_end time;
  break_minutes integer := 0;
  finalization_time timestamptz := clock_timestamp();
  override_day_off boolean;
begin
  if request_id is null or entered_time is null then
    raise exception using errcode = '22023', message = '유효하지 않은 출퇴근 확정 요청입니다.';
  end if;
  select * into event from public.attendance_punch_events where id = target_event_id and user_id = auth.uid() for update;
  if event.id is null then raise exception using errcode = 'P0002', message = '입력 대기 중인 태그 기록을 찾을 수 없습니다.'; end if;

  if event.status = 'completed' then
    if event.finalize_request_id is distinct from finalize_attendance_punch.request_id then
      raise exception using errcode = '22023', message = '이미 다른 요청으로 확정된 출퇴근 기록입니다.';
    end if;
    select * into saved_shift from public.attendance_shifts
    where store_id = event.store_id and (check_in_event_id = event.id or check_out_event_id = event.id);
    return to_jsonb(saved_shift);
  end if;
  if event.status <> 'pending' then raise exception using errcode = '55000', message = '확정할 수 없는 태그 기록입니다.'; end if;
  if event.expires_at <= finalization_time then
    update public.attendance_punch_events set status = 'expired' where id = event.id;
    return jsonb_build_object('id', event.id, 'status', 'expired');
  end if;

  local_date := (event.tagged_at at time zone 'Asia/Seoul')::date;
  entered_timestamp := (local_date + entered_time) at time zone 'Asia/Seoul';
  select * into open_shift from public.attendance_shifts
  where user_id = auth.uid() and store_id = event.store_id and confirmed_check_out_at is null for update;
  if event.punch_type = 'check_out' and open_shift.id is not null and entered_timestamp <= open_shift.confirmed_check_in_at then
    entered_timestamp := entered_timestamp + interval '1 day';
  end if;
  if abs(extract(epoch from (entered_timestamp - event.tagged_at))) > 43200 then
    raise exception using errcode = '22023', message = 'NFC 태그 시각에서 12시간을 벗어난 시간은 저장할 수 없습니다.';
  end if;

  if event.punch_type = 'check_in' then
    select override.is_day_off,
      case when override.is_day_off then null else coalesce(override.start_time, weekly.start_time) end,
      case when override.is_day_off then null else coalesce(override.end_time, weekly.end_time) end,
      case when override.is_day_off then 0 else coalesce(override.unpaid_break_minutes, weekly.unpaid_break_minutes, 0) end
    into override_day_off, schedule_start, schedule_end, break_minutes
    from (select 1) seed
    left join lateral (
      select is_day_off, start_time, end_time, unpaid_break_minutes from public.attendance_schedule_overrides
      where store_id = event.store_id and user_id = auth.uid() and work_date = local_date limit 1
    ) override on true
    left join lateral (
      select start_time, end_time, unpaid_break_minutes from public.attendance_work_schedules
      where store_id = event.store_id and user_id = auth.uid()
        and weekday = extract(dow from local_date)::integer and effective_from <= local_date
        and (effective_to is null or effective_to >= local_date)
      order by effective_from desc limit 1
    ) weekly on true;

    insert into public.attendance_shifts (
      store_id, user_id, check_in_event_id, scheduled_start_at, scheduled_end_at,
      entered_check_in_at, confirmed_check_in_at, unpaid_break_minutes, status
    ) values (
      event.store_id, auth.uid(), event.id,
      case when schedule_start is null then null else (local_date + schedule_start) at time zone 'Asia/Seoul' end,
      case when schedule_end is null then null else ((local_date + schedule_end) at time zone 'Asia/Seoul') + case when schedule_end <= schedule_start then interval '1 day' else interval '0' end end,
      entered_timestamp, entered_timestamp, break_minutes, 'open'
    ) returning * into saved_shift;
  else
    if open_shift.id is null then raise exception using errcode = '55000', message = '퇴근 처리할 열린 근무 기록이 없습니다.'; end if;
    update public.attendance_shifts set
      check_out_event_id = event.id, entered_check_out_at = entered_timestamp, confirmed_check_out_at = entered_timestamp,
      status = 'closed', updated_at = finalization_time
    where id = open_shift.id returning * into saved_shift;
  end if;

  update public.attendance_punch_events
  set entered_at = entered_timestamp, confirmed_at = clock_timestamp(), status = 'completed',
      finalize_request_id = finalize_attendance_punch.request_id, needs_review = false
  where id = event.id;

  if event.punch_type = 'check_out' then perform public.refresh_attendance_segments(saved_shift.id); end if;
  return to_jsonb(saved_shift);
exception when unique_violation then
  select * into event from public.attendance_punch_events where id = target_event_id and user_id = auth.uid();
  if event.status = 'completed' and event.finalize_request_id = finalize_attendance_punch.request_id then
    select * into saved_shift from public.attendance_shifts
    where store_id = event.store_id and (check_in_event_id = event.id or check_out_event_id = event.id);
    return to_jsonb(saved_shift);
  end if;
  raise;
end;
$$;

create or replace function public.manage_attendance_shift(
  target_shift_id uuid, confirmed_check_in timestamptz, confirmed_check_out timestamptz,
  unpaid_break integer, target_status text, change_reason text
) returns public.attendance_shifts language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
declare before_row public.attendance_shifts; after_row public.attendance_shifts; before_segments jsonb;
begin
  select * into before_row from public.attendance_shifts where id = target_shift_id for update;
  if before_row.id is null or not public.attendance_manager(before_row.store_id) then raise exception using errcode = '42501', message = '근태관리 권한이 필요합니다.'; end if;
  if nullif(btrim(change_reason), '') is null or target_status not in ('open', 'closed', 'needs_review', 'approved') then raise exception using errcode = '22023', message = '수정 사유와 유효한 상태가 필요합니다.'; end if;
  if target_status = 'approved' and not exists (
    select 1 from public.attendance_payroll_rules
    where store_id = before_row.store_id and effective_from <= (confirmed_check_in at time zone 'Asia/Seoul')::date
      and (effective_to is null or effective_to >= (confirmed_check_in at time zone 'Asia/Seoul')::date) and is_confirmed
  ) then raise exception using errcode = '55000', message = '사업장 법정수당 기준을 먼저 확정해야 합니다.'; end if;
  if confirmed_check_in is null or unpaid_break is null or unpaid_break < 0 then raise exception using errcode = '22023', message = '출근 시각과 유효한 휴게시간이 필요합니다.'; end if;
  if confirmed_check_out is not null and confirmed_check_out <= confirmed_check_in then raise exception using errcode = '22023', message = '퇴근 시각은 출근 시각보다 뒤여야 합니다.'; end if;
  if confirmed_check_out is not null and unpaid_break * 60 >= extract(epoch from (confirmed_check_out - confirmed_check_in)) then
    raise exception using errcode = '22023', message = '무급휴게는 전체 근무시간보다 짧아야 합니다.';
  end if;
  if (target_status = 'open' and confirmed_check_out is not null)
    or (target_status in ('closed', 'approved') and confirmed_check_out is null) then
    raise exception using errcode = '22023', message = '상태와 출퇴근 시각이 일치하지 않습니다.';
  end if;
  select coalesce(jsonb_agg(to_jsonb(segment) order by segment.starts_at), '[]'::jsonb)
  into before_segments from public.attendance_shift_segments segment where segment.shift_id = before_row.id;
  update public.attendance_shifts set confirmed_check_in_at = confirmed_check_in, confirmed_check_out_at = confirmed_check_out,
    unpaid_break_minutes = unpaid_break, status = target_status, manager_note = btrim(change_reason), updated_at = clock_timestamp()
  where id = target_shift_id returning * into after_row;
  insert into public.attendance_shift_audit (shift_id, store_id, changed_by, reason, before_values, after_values)
  values (after_row.id, after_row.store_id, auth.uid(), btrim(change_reason), to_jsonb(before_row), to_jsonb(after_row));
  delete from public.attendance_shift_segments where shift_id = before_row.id;
  perform public.audit_attendance_management(after_row.store_id, 'shift_segment_reset', after_row.id,
    '근무 수정으로 수당 구간 초기화: ' || btrim(change_reason), before_segments, '[]'::jsonb);
  perform public.refresh_attendance_segments(after_row.id);
  return after_row;
end;
$$;

create or replace function public.save_attendance_work_schedule(
  target_user_id uuid, target_weekday smallint, target_start_time time, target_end_time time,
  target_break_minutes integer, target_effective_from date, target_effective_to date, change_reason text
) returns public.attendance_work_schedules language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
declare caller_store uuid; saved public.attendance_work_schedules;
begin
  select store_id into caller_store from public.profiles where id = auth.uid();
  if caller_store is null or not public.attendance_manager(caller_store) then raise exception using errcode = '42501', message = '근태관리 권한이 필요합니다.'; end if;
  if not exists (select 1 from public.profiles where id = target_user_id and store_id = caller_store) then raise exception using errcode = '23503', message = '같은 매장 직원을 선택해야 합니다.'; end if;
  if nullif(btrim(change_reason), '') is null or target_start_time is null or target_end_time is null
    or target_break_minutes is null or target_break_minutes < 0 or target_effective_from is null
    or (target_effective_to is not null and target_effective_to < target_effective_from) then
    raise exception using errcode = '22023', message = '유효한 반복 일정과 변경 사유가 필요합니다.';
  end if;
  insert into public.attendance_work_schedules
    (store_id, user_id, weekday, start_time, end_time, unpaid_break_minutes, effective_from, effective_to, created_by)
  values
    (caller_store, target_user_id, target_weekday, target_start_time, target_end_time, target_break_minutes, target_effective_from, target_effective_to, auth.uid())
  returning * into saved;
  perform public.audit_attendance_management(caller_store, 'work_schedule', saved.id, change_reason, null, to_jsonb(saved));
  return saved;
end;
$$;

create or replace function public.save_attendance_schedule_override(
  target_user_id uuid, target_work_date date, target_is_day_off boolean, target_start_time time,
  target_end_time time, target_break_minutes integer, target_note text, change_reason text
) returns public.attendance_schedule_overrides language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
declare caller_store uuid; saved public.attendance_schedule_overrides;
begin
  select store_id into caller_store from public.profiles where id = auth.uid();
  if caller_store is null or not public.attendance_manager(caller_store) then raise exception using errcode = '42501', message = '근태관리 권한이 필요합니다.'; end if;
  if not exists (select 1 from public.profiles where id = target_user_id and store_id = caller_store) then raise exception using errcode = '23503', message = '같은 매장 직원을 선택해야 합니다.'; end if;
  if nullif(btrim(change_reason), '') is null or target_work_date is null or target_is_day_off is null
    or (target_is_day_off and (target_start_time is not null or target_end_time is not null))
    or (not target_is_day_off and (target_start_time is null or target_end_time is null))
    or target_break_minutes is null or target_break_minutes < 0 then
    raise exception using errcode = '22023', message = '유효한 예외 일정과 변경 사유가 필요합니다.';
  end if;
  insert into public.attendance_schedule_overrides
    (store_id, user_id, work_date, is_day_off, start_time, end_time, unpaid_break_minutes, note, created_by)
  values
    (caller_store, target_user_id, target_work_date, target_is_day_off, target_start_time, target_end_time, target_break_minutes, target_note, auth.uid())
  on conflict (store_id, user_id, work_date) do update set
    is_day_off = excluded.is_day_off, start_time = excluded.start_time, end_time = excluded.end_time,
    unpaid_break_minutes = excluded.unpaid_break_minutes, note = excluded.note, created_by = auth.uid(), created_at = clock_timestamp()
  returning * into saved;
  perform public.audit_attendance_management(caller_store, 'schedule_override', saved.id, change_reason, null, to_jsonb(saved));
  return saved;
end;
$$;

create or replace function public.save_attendance_pay_rate(
  target_user_id uuid, target_hourly_wage bigint, target_weekly_contracted_minutes integer,
  target_effective_from date, target_effective_to date, change_reason text
) returns public.attendance_pay_rates language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
declare caller_store uuid; saved public.attendance_pay_rates; previous_rate public.attendance_pay_rates;
begin
  select store_id into caller_store from public.profiles where id = auth.uid();
  if caller_store is null or not public.can_admin_store(caller_store) then raise exception using errcode = '42501', message = '매장 관리자 권한이 필요합니다.'; end if;
  if not exists (select 1 from public.profiles where id = target_user_id and store_id = caller_store) then raise exception using errcode = '23503', message = '같은 매장 직원을 선택해야 합니다.'; end if;
  if nullif(btrim(change_reason), '') is null or target_hourly_wage is null or target_hourly_wage < 0
    or target_weekly_contracted_minutes is null or target_weekly_contracted_minutes not between 0 and 10080
    or target_effective_from is null or (target_effective_to is not null and target_effective_to < target_effective_from) then
    raise exception using errcode = '22023', message = '유효한 시급 이력과 변경 사유가 필요합니다.';
  end if;
  select * into previous_rate from public.attendance_pay_rates
  where store_id = caller_store and user_id = target_user_id
    and effective_from < target_effective_from
    and (effective_to is null or effective_to >= target_effective_from)
  order by effective_from desc limit 1 for update;
  if previous_rate.id is not null then
    update public.attendance_pay_rates set effective_to = target_effective_from - 1 where id = previous_rate.id;
  end if;
  insert into public.attendance_pay_rates
    (store_id, user_id, hourly_wage, weekly_contracted_minutes, effective_from, effective_to, created_by)
  values
    (caller_store, target_user_id, target_hourly_wage, target_weekly_contracted_minutes, target_effective_from, target_effective_to, auth.uid())
  returning * into saved;
  perform public.audit_attendance_management(caller_store, 'pay_rate', saved.id, change_reason, null, to_jsonb(saved));
  return saved;
end;
$$;

create or replace function public.save_attendance_payroll_rules(
  target_effective_from date, target_effective_to date, target_overtime_multiplier numeric,
  target_night_multiplier numeric, target_holiday_multiplier numeric, target_weekly_threshold_minutes integer,
  target_weekly_overtime_threshold_minutes integer,
  target_rounding_rule text, target_rounding_version integer, target_is_confirmed boolean, change_reason text
) returns public.attendance_payroll_rules language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
declare caller_store uuid; saved public.attendance_payroll_rules; previous_rule public.attendance_payroll_rules;
begin
  select store_id into caller_store from public.profiles where id = auth.uid();
  if caller_store is null or not public.can_admin_store(caller_store) then raise exception using errcode = '42501', message = '매장 관리자 권한이 필요합니다.'; end if;
  if nullif(btrim(change_reason), '') is null or target_effective_from is null
    or (target_effective_to is not null and target_effective_to < target_effective_from)
    or target_overtime_multiplier < 0 or target_night_multiplier < 0 or target_holiday_multiplier < 0
    or target_weekly_threshold_minutes < 0 or target_weekly_overtime_threshold_minutes < 0
    or target_rounding_rule not in ('half_up', 'floor', 'ceil') or target_rounding_version <= 0
    or target_is_confirmed is null then
    raise exception using errcode = '22023', message = '유효한 급여 기준과 변경 사유가 필요합니다.';
  end if;
  select * into previous_rule from public.attendance_payroll_rules
  where store_id = caller_store and effective_from < target_effective_from
    and (effective_to is null or effective_to >= target_effective_from)
  order by effective_from desc limit 1 for update;
  if previous_rule.id is not null then
    update public.attendance_payroll_rules set effective_to = target_effective_from - 1,
      updated_by = auth.uid(), updated_at = clock_timestamp()
    where id = previous_rule.id;
  end if;
  insert into public.attendance_payroll_rules
    (store_id, effective_from, effective_to, overtime_multiplier, night_multiplier, holiday_multiplier,
     weekly_threshold_minutes, weekly_overtime_threshold_minutes, rounding_rule, rounding_version, is_confirmed, updated_by)
  values
    (caller_store, target_effective_from, target_effective_to, target_overtime_multiplier, target_night_multiplier,
     target_holiday_multiplier, target_weekly_threshold_minutes, target_weekly_overtime_threshold_minutes,
     target_rounding_rule, target_rounding_version,
     target_is_confirmed, auth.uid())
  on conflict (store_id, effective_from) do update set
    effective_to = excluded.effective_to, overtime_multiplier = excluded.overtime_multiplier,
    night_multiplier = excluded.night_multiplier, holiday_multiplier = excluded.holiday_multiplier,
    weekly_threshold_minutes = excluded.weekly_threshold_minutes,
    weekly_overtime_threshold_minutes = excluded.weekly_overtime_threshold_minutes, rounding_rule = excluded.rounding_rule,
    rounding_version = excluded.rounding_version, is_confirmed = excluded.is_confirmed,
    updated_by = auth.uid(), updated_at = clock_timestamp()
  returning * into saved;
  perform public.audit_attendance_management(caller_store, 'payroll_rule', saved.id, change_reason, null, to_jsonb(saved));
  return saved;
end;
$$;

create or replace function public.confirm_attendance_segments(
  target_shift_id uuid, target_segment_id uuid, target_status text, change_reason text
) returns public.attendance_shift_segments language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
declare caller_store uuid; target_shift public.attendance_shifts; before_row public.attendance_shift_segments; saved public.attendance_shift_segments;
begin
  select store_id into caller_store from public.profiles where id = auth.uid();
  select * into target_shift from public.attendance_shifts where id = target_shift_id and store_id = caller_store;
  if target_shift.id is null or not public.attendance_manager(caller_store) then raise exception using errcode = '42501', message = '근태관리 권한이 필요합니다.'; end if;
  if target_status not in ('confirmed', 'rejected') or nullif(btrim(change_reason), '') is null then raise exception using errcode = '22023', message = '확정 또는 제외 상태와 변경 사유가 필요합니다.'; end if;
  select * into before_row from public.attendance_shift_segments
  where id = target_segment_id and shift_id = target_shift.id and store_id = caller_store for update;
  if before_row.id is null then raise exception using errcode = '23503', message = '같은 매장의 수당 구간을 선택해야 합니다.'; end if;
  update public.attendance_shift_segments set status = target_status, confirmed_by = auth.uid(), confirmed_at = clock_timestamp()
  where id = before_row.id returning * into saved;
  perform public.audit_attendance_management(caller_store, 'shift_segment', saved.id, change_reason, to_jsonb(before_row), to_jsonb(saved));
  return saved;
end;
$$;

create or replace function public.confirm_attendance_weekly_allowance(
  target_user_id uuid, target_week_start date, target_eligible boolean,
  target_note text, change_reason text
) returns public.attendance_weekly_allowances language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
declare
  caller_store uuid;
  saved public.attendance_weekly_allowances;
  before_row public.attendance_weekly_allowances;
  rate public.attendance_pay_rates;
  rule public.attendance_payroll_rules;
  eligible_minutes integer;
  derived_amount bigint;
  approval_time timestamptz := clock_timestamp();
begin
  select store_id into caller_store from public.profiles where id = auth.uid();
  if caller_store is null or not public.attendance_manager(caller_store) then raise exception using errcode = '42501', message = '근태관리 권한이 필요합니다.'; end if;
  if target_week_start is null or target_eligible is null or nullif(btrim(change_reason), '') is null then raise exception using errcode = '22023', message = '주 시작일, 대상 여부, 변경 사유가 필요합니다.'; end if;
  if extract(isodow from target_week_start) <> 1 then raise exception using errcode = '22023', message = '주 시작일은 월요일이어야 합니다.'; end if;
  if not exists (select 1 from public.profiles where id = target_user_id and store_id = caller_store) then raise exception using errcode = '23503', message = '같은 매장 직원을 선택해야 합니다.'; end if;

  select * into rate from public.attendance_pay_rates
  where store_id = caller_store and user_id = target_user_id and effective_from <= target_week_start
    and (effective_to is null or effective_to >= target_week_start)
  order by effective_from desc limit 1;
  select * into rule from public.attendance_payroll_rules
  where store_id = caller_store and effective_from <= target_week_start
    and (effective_to is null or effective_to >= target_week_start)
  order by effective_from desc limit 1;
  if rate.id is null or rule.id is null then raise exception using errcode = '55000', message = '적용 시급과 급여 기준이 필요합니다.'; end if;

  select coalesce(sum(greatest(0, floor(extract(epoch from
    (shift.confirmed_check_out_at - shift.confirmed_check_in_at)) / 60)::integer - shift.unpaid_break_minutes)), 0)::integer
  into eligible_minutes from public.attendance_shifts shift
  where shift.store_id = caller_store and shift.user_id = target_user_id
    and shift.confirmed_check_out_at is not null
    and (shift.confirmed_check_in_at at time zone 'Asia/Seoul')::date between target_week_start and target_week_start + 6;

  target_eligible := target_eligible and eligible_minutes >= rule.weekly_threshold_minutes;
  derived_amount := case when target_eligible then
    case rule.rounding_rule
      when 'floor' then floor(least(rate.weekly_contracted_minutes::numeric / 300, 8) * rate.hourly_wage)
      when 'ceil' then ceil(least(rate.weekly_contracted_minutes::numeric / 300, 8) * rate.hourly_wage)
      else round(least(rate.weekly_contracted_minutes::numeric / 300, 8) * rate.hourly_wage)
    end::bigint else 0 end;

  select * into before_row from public.attendance_weekly_allowances
  where store_id = caller_store and user_id = target_user_id and week_start = target_week_start for update;
  insert into public.attendance_weekly_allowances
    (store_id, user_id, week_start, eligible, allowance_amount, confirmed_by, confirmed_at, note)
  values
    (caller_store, target_user_id, target_week_start, target_eligible, derived_amount, auth.uid(), approval_time, target_note)
  on conflict (store_id, user_id, week_start) do update set
    eligible = excluded.eligible, allowance_amount = excluded.allowance_amount,
    confirmed_by = auth.uid(), confirmed_at = approval_time, note = excluded.note
  returning * into saved;
  perform public.audit_attendance_management(caller_store, 'weekly_allowance', saved.id, change_reason, to_jsonb(before_row), to_jsonb(saved));
  return saved;
end;
$$;

alter table public.attendance_tags enable row level security;
alter table public.attendance_work_schedules enable row level security;
alter table public.attendance_schedule_overrides enable row level security;
alter table public.attendance_pay_rates enable row level security;
alter table public.attendance_payroll_rules enable row level security;
alter table public.attendance_punch_events enable row level security;
alter table public.attendance_shifts enable row level security;
alter table public.attendance_shift_segments enable row level security;
alter table public.attendance_weekly_allowances enable row level security;
alter table public.attendance_shift_audit enable row level security;
alter table public.attendance_management_audit enable row level security;

create policy "Attendance managers read tags" on public.attendance_tags for select to authenticated using (public.attendance_manager(store_id));
create policy "Attendance managers read schedules" on public.attendance_work_schedules for select to authenticated using (public.attendance_manager(store_id));
create policy "Attendance managers read schedule overrides" on public.attendance_schedule_overrides for select to authenticated using (public.attendance_manager(store_id));
create policy "Attendance managers read pay rates" on public.attendance_pay_rates for select to authenticated using (public.attendance_manager(store_id));
create policy "Attendance managers read payroll rules" on public.attendance_payroll_rules for select to authenticated using (public.attendance_manager(store_id));
create policy "Attendance managers read punch events" on public.attendance_punch_events for select to authenticated using (public.attendance_manager(store_id));
create policy "Attendance managers read shifts" on public.attendance_shifts for select to authenticated using (public.attendance_manager(store_id));
create policy "Attendance managers read segments" on public.attendance_shift_segments for select to authenticated using (public.attendance_manager(store_id));
create policy "Attendance managers read weekly allowances" on public.attendance_weekly_allowances for select to authenticated using (public.attendance_manager(store_id));
create policy "Attendance managers read shift audit" on public.attendance_shift_audit for select to authenticated using (public.attendance_manager(store_id));
create policy "Attendance managers read management audit" on public.attendance_management_audit for select to authenticated using (public.attendance_manager(store_id));

revoke all on public.attendance_tags, public.attendance_work_schedules, public.attendance_schedule_overrides,
  public.attendance_pay_rates, public.attendance_payroll_rules, public.attendance_punch_events,
  public.attendance_shifts, public.attendance_shift_segments, public.attendance_weekly_allowances,
  public.attendance_shift_audit, public.attendance_management_audit from public, anon, authenticated;
grant select on public.attendance_tags, public.attendance_work_schedules, public.attendance_schedule_overrides,
  public.attendance_pay_rates, public.attendance_payroll_rules, public.attendance_punch_events,
  public.attendance_shifts, public.attendance_shift_segments, public.attendance_weekly_allowances,
  public.attendance_shift_audit, public.attendance_management_audit to authenticated;

revoke all on function public.create_default_attendance_payroll_rule() from public, anon, authenticated;
revoke all on function public.audit_attendance_management(uuid, text, uuid, text, jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.refresh_attendance_segments(uuid) from public, anon, authenticated;
revoke all on function public.attendance_punch_prompt(uuid) from public, anon, authenticated;
revoke all on function public.create_attendance_tag(text) from public, anon;
revoke all on function public.update_attendance_tag(uuid, text, boolean) from public, anon;
revoke all on function public.rotate_attendance_tag(uuid, text) from public, anon;
revoke all on function public.begin_attendance_punch(text, uuid) from public, anon;
revoke all on function public.get_my_pending_attendance_punch() from public, anon;
revoke all on function public.finalize_attendance_punch(uuid, time, uuid) from public, anon;
revoke all on function public.manage_attendance_shift(uuid, timestamptz, timestamptz, integer, text, text) from public, anon;
revoke all on function public.recalculate_attendance_segments(uuid) from public, anon;
revoke all on function public.attendance_manager(uuid) from public, anon;
revoke all on function public.save_attendance_work_schedule(uuid, smallint, time, time, integer, date, date, text) from public, anon;
revoke all on function public.save_attendance_schedule_override(uuid, date, boolean, time, time, integer, text, text) from public, anon;
revoke all on function public.save_attendance_pay_rate(uuid, bigint, integer, date, date, text) from public, anon;
revoke all on function public.save_attendance_payroll_rules(date, date, numeric, numeric, numeric, integer, integer, text, integer, boolean, text) from public, anon;
revoke all on function public.confirm_attendance_segments(uuid, uuid, text, text) from public, anon;
revoke all on function public.confirm_attendance_weekly_allowance(uuid, date, boolean, text, text) from public, anon;

grant execute on function public.create_attendance_tag(text) to authenticated;
grant execute on function public.update_attendance_tag(uuid, text, boolean) to authenticated;
grant execute on function public.rotate_attendance_tag(uuid, text) to authenticated;
grant execute on function public.begin_attendance_punch(text, uuid) to authenticated;
grant execute on function public.get_my_pending_attendance_punch() to authenticated;
grant execute on function public.finalize_attendance_punch(uuid, time, uuid) to authenticated;
grant execute on function public.manage_attendance_shift(uuid, timestamptz, timestamptz, integer, text, text) to authenticated;
grant execute on function public.recalculate_attendance_segments(uuid) to authenticated;
grant execute on function public.attendance_manager(uuid) to authenticated;
grant execute on function public.save_attendance_work_schedule(uuid, smallint, time, time, integer, date, date, text) to authenticated;
grant execute on function public.save_attendance_schedule_override(uuid, date, boolean, time, time, integer, text, text) to authenticated;
grant execute on function public.save_attendance_pay_rate(uuid, bigint, integer, date, date, text) to authenticated;
grant execute on function public.save_attendance_payroll_rules(date, date, numeric, numeric, numeric, integer, integer, text, integer, boolean, text) to authenticated;
grant execute on function public.confirm_attendance_segments(uuid, uuid, text, text) to authenticated;
grant execute on function public.confirm_attendance_weekly_allowance(uuid, date, boolean, text, text) to authenticated;

notify pgrst, 'reload schema';