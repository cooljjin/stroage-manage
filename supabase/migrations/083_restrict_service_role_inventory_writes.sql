-- service_role is not used by server callers for protected inventory writes.
revoke update on table public.inventory from service_role;
revoke insert on table public.inventory_logs from service_role;
revoke update on table public.product_barcodes from service_role;
