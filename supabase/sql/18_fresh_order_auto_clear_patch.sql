alter table public.products
add column if not exists fresh_order_selected_at timestamptz;

update public.products
set fresh_order_selected_at = now()
where fresh_order_selected = true
  and fresh_order_selected_at is null;

create or replace function public.clear_fresh_order_after_next_day_receipt()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.action = '입고' then
    update public.products
    set fresh_order_selected = false,
        fresh_order_selected_at = null
    where id = new.product_id
      and fresh_order_selected = true
      and fresh_order_selected_at is not null
      and (fresh_order_selected_at at time zone 'Asia/Seoul')::date
          < (new.created_at at time zone 'Asia/Seoul')::date;
  end if;

  return new;
end;
$$;

drop trigger if exists clear_fresh_order_after_next_day_receipt on public.inventory_logs;
create trigger clear_fresh_order_after_next_day_receipt
after insert on public.inventory_logs
for each row
execute function public.clear_fresh_order_after_next_day_receipt();

notify pgrst, 'reload schema';
