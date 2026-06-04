alter table public.categories add column if not exists sort_order integer not null default 1000;

update public.categories
set sort_order = case name
  when '원두' then 1
  when '우유' then 2
  when '시럽' then 3
  when '베이커리' then 4
  when '아이스크림' then 5
  when '소모품' then 6
  when '음료' then 7
  when '기타' then 8
  else sort_order
end;

create index if not exists categories_sort_order_idx on public.categories (sort_order, name);

notify pgrst, 'reload schema';
