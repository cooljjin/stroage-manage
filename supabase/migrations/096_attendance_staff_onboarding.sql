-- Register and schedule an employee before their Stockly account exists.
create table public.attendance_pending_staff (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  display_name text not null check (char_length(btrim(display_name)) between 1 and 80),
  phone text check (phone is null or char_length(btrim(phone)) between 1 and 40),
  invite_id uuid unique references public.store_invites(id) on delete set null,
  linked_profile_id uuid unique references public.profiles(id) on delete set null,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, store_id)
);

create index attendance_pending_staff_store_idx on public.attendance_pending_staff (store_id, display_name);

create table public.attendance_pending_staff_dates (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  pending_staff_id uuid not null,
  work_date date not null,
  start_time time not null,
  end_time time not null,
  unpaid_break_minutes integer not null default 0 check (unpaid_break_minutes between 0 and 720),
  foreign key (pending_staff_id, store_id) references public.attendance_pending_staff (id, store_id) on delete cascade,
  unique (pending_staff_id, work_date),
  check (end_time > start_time)
);

create index attendance_pending_staff_dates_store_date_idx on public.attendance_pending_staff_dates (store_id, work_date);

alter table public.attendance_pending_staff enable row level security;
alter table public.attendance_pending_staff_dates enable row level security;

create policy "Store admins read pending staff" on public.attendance_pending_staff
for select to authenticated using (
  store_id = public.current_store_id(auth.uid()) and public.current_role(auth.uid()) = 'store_admin'
);
create policy "Store admins read pending staff dates" on public.attendance_pending_staff_dates
for select to authenticated using (
  store_id = public.current_store_id(auth.uid()) and public.current_role(auth.uid()) = 'store_admin'
);

revoke all on public.attendance_pending_staff, public.attendance_pending_staff_dates from public, anon, authenticated;
grant select on public.attendance_pending_staff, public.attendance_pending_staff_dates to authenticated;

create function public.create_attendance_pending_staff(
  target_name text, target_phone text, target_dates date[],
  target_start_time time, target_end_time time, target_break_minutes integer
) returns public.attendance_pending_staff
language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
declare
  caller_store uuid;
  saved public.attendance_pending_staff%rowtype;
begin
  caller_store := public.current_store_id(auth.uid());
  if caller_store is null or public.current_role(auth.uid()) <> 'store_admin' then
    raise exception using errcode = '42501', message = '직원 등록 권한이 필요합니다.';
  end if;
  if nullif(btrim(target_name), '') is null or char_length(btrim(target_name)) > 80 then
    raise exception using errcode = '22023', message = '직원 이름을 확인해 주세요.';
  end if;
  if target_phone is not null and char_length(btrim(target_phone)) > 40 then
    raise exception using errcode = '22023', message = '연락처는 40자 이하로 입력해 주세요.';
  end if;
  if coalesce(cardinality(target_dates), 0) > 100 then
    raise exception using errcode = '22023', message = '한 번에 등록할 근무일은 100일 이하로 선택해 주세요.';
  end if;
  if coalesce(cardinality(target_dates), 0) > 0 and
     (target_start_time is null or target_end_time is null or target_end_time <= target_start_time or
      target_break_minutes is null or target_break_minutes < 0 or target_break_minutes > 720 or
      target_break_minutes >= extract(epoch from (target_end_time - target_start_time)) / 60) then
    raise exception using errcode = '22023', message = '근무 시간과 휴게 시간을 확인해 주세요.';
  end if;

  insert into public.attendance_pending_staff (store_id, display_name, phone, created_by)
  values (caller_store, btrim(target_name), nullif(btrim(target_phone), ''), auth.uid())
  returning * into saved;

  insert into public.attendance_pending_staff_dates
    (store_id, pending_staff_id, work_date, start_time, end_time, unpaid_break_minutes)
  select caller_store, saved.id, day, target_start_time, target_end_time, target_break_minutes
  from (select distinct unnest(target_dates) as day) selected
  where day is not null;

  return saved;
end;
$$;

create function public.create_attendance_pending_invite(target_pending_id uuid)
returns public.store_invites
language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
declare
  pending public.attendance_pending_staff%rowtype;
  invite public.store_invites%rowtype;
begin
  if public.current_role(auth.uid()) <> 'store_admin' then
    raise exception using errcode = '42501', message = '직원 초대 권한이 필요합니다.';
  end if;
  select * into pending from public.attendance_pending_staff
  where id = target_pending_id and store_id = public.current_store_id(auth.uid()) for update;
  if not found or pending.linked_profile_id is not null then
    raise exception using errcode = '22023', message = '초대할 수 없는 직원입니다.';
  end if;
  if pending.invite_id is not null then
    select * into invite from public.store_invites where id = pending.invite_id;
    if invite.accepted_at is null and invite.revoked_at is null and invite.expires_at > now() then
      return invite;
    end if;
  end if;
  invite := public.create_store_invite('staff');
  update public.attendance_pending_staff set invite_id = invite.id, updated_at = now() where id = pending.id;
  return invite;
end;
$$;

create function public.save_attendance_pending_staff_dates(
  target_pending_id uuid, target_dates date[], target_start_time time,
  target_end_time time, target_break_minutes integer
) returns integer
language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
declare
  pending public.attendance_pending_staff%rowtype;
  saved_count integer;
begin
  if public.current_role(auth.uid()) <> 'store_admin' then
    raise exception using errcode = '42501', message = '근무 일정을 등록할 권한이 없습니다.';
  end if;
  select * into pending from public.attendance_pending_staff
  where id = target_pending_id and store_id = public.current_store_id(auth.uid())
    and linked_profile_id is null for update;
  if not found then raise exception using errcode = 'P0002', message = '가입 전 직원을 찾을 수 없습니다.'; end if;
  if coalesce(cardinality(target_dates), 0) = 0 or cardinality(target_dates) > 100
    or target_start_time is null or target_end_time is null or target_end_time <= target_start_time
    or target_break_minutes is null or target_break_minutes < 0 or target_break_minutes > 720
    or target_break_minutes >= extract(epoch from (target_end_time - target_start_time)) / 60 then
    raise exception using errcode = '22023', message = '근무 날짜와 시간을 확인해 주세요.';
  end if;
  insert into public.attendance_pending_staff_dates
    (store_id, pending_staff_id, work_date, start_time, end_time, unpaid_break_minutes)
  select pending.store_id, pending.id, day, target_start_time, target_end_time, target_break_minutes
  from (select distinct unnest(target_dates) as day) selected where day is not null
  on conflict (pending_staff_id, work_date) do update set
    start_time = excluded.start_time, end_time = excluded.end_time,
    unpaid_break_minutes = excluded.unpaid_break_minutes;
  get diagnostics saved_count = row_count;
  return saved_count;
end;
$$;

create function public.update_attendance_pending_staff(target_pending_id uuid, target_name text, target_phone text)
returns public.attendance_pending_staff
language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
declare saved public.attendance_pending_staff%rowtype;
begin
  if public.current_role(auth.uid()) <> 'store_admin' or nullif(btrim(target_name), '') is null
     or char_length(btrim(target_name)) > 80 or (target_phone is not null and char_length(btrim(target_phone)) > 40) then
    raise exception using errcode = '22023', message = '직원 정보를 확인해 주세요.';
  end if;
  update public.attendance_pending_staff
  set display_name = btrim(target_name), phone = nullif(btrim(target_phone), ''), updated_at = now()
  where id = target_pending_id and store_id = public.current_store_id(auth.uid())
    and linked_profile_id is null
  returning * into saved;
  if not found then raise exception using errcode = 'P0002', message = '가입 전 직원을 찾을 수 없습니다.'; end if;
  return saved;
end;
$$;

create function public.delete_attendance_pending_staff(target_pending_id uuid)
returns void language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
declare pending public.attendance_pending_staff%rowtype;
begin
  if public.current_role(auth.uid()) <> 'store_admin' then
    raise exception using errcode = '42501', message = '직원 삭제 권한이 필요합니다.';
  end if;
  select * into pending from public.attendance_pending_staff
  where id = target_pending_id and store_id = public.current_store_id(auth.uid())
    and linked_profile_id is null for update;
  if not found then raise exception using errcode = 'P0002', message = '가입 전 직원을 찾을 수 없습니다.'; end if;
  if pending.invite_id is not null then
    update public.store_invites set revoked_at = now()
    where id = pending.invite_id and accepted_at is null;
  end if;
  delete from public.attendance_pending_staff where id = pending.id;
end;
$$;

-- The existing acceptance RPC updates store_invites in the same transaction.
create function public.link_attendance_pending_staff_after_invite()
returns trigger language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
declare
  pending public.attendance_pending_staff%rowtype;
  planned public.attendance_pending_staff_dates%rowtype;
  saved public.attendance_schedule_overrides%rowtype;
begin
  if new.accepted_by is null or old.accepted_by is not distinct from new.accepted_by then return new; end if;
  select * into pending from public.attendance_pending_staff
  where invite_id = new.id and store_id = new.store_id for update;
  if not found then return new; end if;

  update public.attendance_pending_staff
  set linked_profile_id = new.accepted_by, updated_at = now() where id = pending.id;
  update public.profiles set display_name = pending.display_name
  where id = new.accepted_by and store_id = new.store_id;

  for planned in select * from public.attendance_pending_staff_dates
    where pending_staff_id = pending.id order by work_date loop
    insert into public.attendance_schedule_overrides
      (store_id, user_id, work_date, is_day_off, start_time, end_time,
       unpaid_break_minutes, note, created_by)
    values
      (pending.store_id, new.accepted_by, planned.work_date, false,
       planned.start_time, planned.end_time, planned.unpaid_break_minutes,
       '직원 등록 시 예약한 근무', pending.created_by)
    on conflict (store_id, user_id, work_date) do nothing
    returning * into saved;
    if saved.id is not null then
      insert into public.attendance_management_audit
        (store_id, entity_type, entity_id, changed_by, reason, before_values, after_values)
      values (pending.store_id, 'schedule_override', saved.id, pending.created_by,
        '가입 전 등록한 근무 일정 연결', null, to_jsonb(saved));
    end if;
    saved := null;
  end loop;
  return new;
end;
$$;

create trigger link_attendance_pending_staff_after_invite
after update of accepted_by on public.store_invites
for each row execute function public.link_attendance_pending_staff_after_invite();

revoke all on function public.create_attendance_pending_staff(text, text, date[], time, time, integer) from public, anon;
revoke all on function public.create_attendance_pending_invite(uuid) from public, anon;
revoke all on function public.save_attendance_pending_staff_dates(uuid, date[], time, time, integer) from public, anon;
revoke all on function public.update_attendance_pending_staff(uuid, text, text) from public, anon;
revoke all on function public.delete_attendance_pending_staff(uuid) from public, anon;
grant execute on function public.create_attendance_pending_staff(text, text, date[], time, time, integer) to authenticated;
grant execute on function public.create_attendance_pending_invite(uuid) to authenticated;
grant execute on function public.save_attendance_pending_staff_dates(uuid, date[], time, time, integer) to authenticated;
grant execute on function public.update_attendance_pending_staff(uuid, text, text) to authenticated;
grant execute on function public.delete_attendance_pending_staff(uuid) to authenticated;
