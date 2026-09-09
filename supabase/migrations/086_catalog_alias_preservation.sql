-- Preserve catalog metadata across reversible alias merges.
-- Existing alias rows remain readable; nullable snapshot columns are legacy-safe.

alter table public.product_alias_links
  add column if not exists catalog_id_snapshot uuid,
  add column if not exists brand_snapshot text,
  add column if not exists image_url_snapshot text,
  add column if not exists catalog_confirmed_at_snapshot timestamptz;

create or replace function public.capture_alias_catalog_snapshot()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.catalog_id_snapshot is null
    and new.brand_snapshot is null
    and new.image_url_snapshot is null
    and new.catalog_confirmed_at_snapshot is null then
    select product.catalog_id,
           product.brand,
           product.image_url,
           product.catalog_confirmed_at
    into new.catalog_id_snapshot,
         new.brand_snapshot,
         new.image_url_snapshot,
         new.catalog_confirmed_at_snapshot
    from public.products product
    where product.id = new.alias_product_id
      and product.store_id = new.store_id;
  end if;
  return new;
end;
$$;

drop trigger if exists capture_alias_catalog_snapshot on public.product_alias_links;
create trigger capture_alias_catalog_snapshot
before insert on public.product_alias_links
for each row execute function public.capture_alias_catalog_snapshot();

create or replace function public.restore_alias_catalog_snapshot()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  snapshot jsonb := coalesce(new.product_snapshot, '{}'::jsonb);
  snapshot_catalog_id uuid;
  restored_catalog_id uuid;
begin
  if old.unmerged_at is null and new.unmerged_at is not null then
    if new.catalog_id_snapshot is null
      and snapshot ? 'catalog_id'
      and nullif(snapshot->>'catalog_id', '') is not null then
      snapshot_catalog_id := (snapshot->>'catalog_id')::uuid;
    end if;

    restored_catalog_id := coalesce(new.catalog_id_snapshot, snapshot_catalog_id);
    if restored_catalog_id is not null
      and not exists (
        select 1 from public.product_catalog catalog
        where catalog.id = restored_catalog_id
      ) then
      restored_catalog_id := null;
    end if;

    perform set_config('app.product_alias_mutation', 'on', true);
    update public.products product
    set catalog_id = restored_catalog_id,
        brand = coalesce(
          new.brand_snapshot,
          case when snapshot ? 'brand' then snapshot->>'brand' end
        ),
        image_url = coalesce(
          new.image_url_snapshot,
          case when snapshot ? 'image_url' then snapshot->>'image_url' end
        ),
        catalog_confirmed_at = coalesce(
          new.catalog_confirmed_at_snapshot,
          case when snapshot ? 'catalog_confirmed_at'
            and nullif(snapshot->>'catalog_confirmed_at', '') is not null
            then (snapshot->>'catalog_confirmed_at')::timestamptz end
        )
    where product.id = new.alias_product_id
      and product.store_id = new.store_id;
  end if;
  return new;
end;
$$;

drop trigger if exists restore_alias_catalog_snapshot on public.product_alias_links;
create trigger restore_alias_catalog_snapshot
after update of unmerged_at on public.product_alias_links
for each row
when (old.unmerged_at is null and new.unmerged_at is not null)
execute function public.restore_alias_catalog_snapshot();

-- Read-only state for resolved-product consumers. A mixed state means the
-- canonical product and active aliases reference more than one catalog row.
create or replace function public.resolve_product_catalog_state(
  target_product_id uuid
)
returns table (
  requested_product_id uuid,
  canonical_product_id uuid,
  canonical_catalog_id uuid,
  alias_catalog_ids uuid[],
  is_mixed_catalog boolean
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  target_store_id uuid;
  resolved_product_id uuid;
  catalog_ids uuid[];
  alias_catalog_ids_value uuid[];
begin
  if auth.uid() is null then
    raise exception '로그인이 필요합니다.';
  end if;

  select product.store_id, public.resolve_canonical_product_id(product.id)
  into target_store_id, resolved_product_id
  from public.products product
  where product.id = target_product_id;

  if target_store_id is null or not public.can_access_store(target_store_id) then
    raise exception '상품을 찾을 수 없습니다.';
  end if;

  select coalesce(array_agg(distinct group_product.catalog_id order by group_product.catalog_id)
    filter (where group_product.catalog_id is not null), '{}'::uuid[])
  into catalog_ids
  from public.products group_product
  where group_product.id = resolved_product_id
     or group_product.id in (
       select link.alias_product_id
       from public.product_alias_links link
       where link.canonical_product_id = resolved_product_id
         and link.unmerged_at is null
     );

  select coalesce(array_agg(distinct alias_product.catalog_id order by alias_product.catalog_id)
    filter (where alias_product.catalog_id is not null), '{}'::uuid[])
  into alias_catalog_ids_value
  from public.product_alias_links link
  join public.products alias_product on alias_product.id = link.alias_product_id
  where link.canonical_product_id = resolved_product_id
    and link.unmerged_at is null;

  return query
  select target_product_id,
         resolved_product_id,
         canonical.catalog_id,
         alias_catalog_ids_value,
         cardinality(catalog_ids) > 1
  from public.products canonical
  where canonical.id = resolved_product_id;
end;
$$;

revoke all on function public.capture_alias_catalog_snapshot() from public, anon, authenticated, service_role;
revoke all on function public.restore_alias_catalog_snapshot() from public, anon, authenticated, service_role;
revoke all on function public.resolve_product_catalog_state(uuid) from public, anon;
grant execute on function public.resolve_product_catalog_state(uuid) to authenticated;

notify pgrst, 'reload schema';
