alter table public.group_order_events
  add column if not exists customer_contact text;
