alter table public.suppliers
  add column if not exists order_method text not null default 'link',
  add column if not exists sms_phone text,
  add column if not exists sms_template text;

alter table public.suppliers drop constraint if exists suppliers_order_method_check;
alter table public.suppliers add constraint suppliers_order_method_check
  check (order_method in ('link', 'sms'));

notify pgrst, 'reload schema';
