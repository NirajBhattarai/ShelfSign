-- Per-warehouse categories + photos, and a backend-owned category list.
-- A supplier can run warehouses selling entirely different things (e.g.
-- furniture in one, agriculture in another), so category tags move from
-- the supplier's profile to the warehouse itself.

create table categories (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  created_at timestamptz not null default now()
);

alter table categories enable row level security;

-- Publicly browsable (same pattern as profiles/attestations); only the
-- service-role backend manages the list, so no write policy is defined.
create policy "categories select all" on categories
  for select using (true);

insert into categories (name) values
  ('Chair'), ('Monitor'), ('Table');

alter table warehouses add column categories text[] not null default '{}';
alter table warehouses add column image_url text;

-- Warehouses need to be buyer-browsable (name, location, categories,
-- image) now that browsing happens per-warehouse, not per-supplier.
-- Writes stay owner-only.
drop policy "warehouses select own" on warehouses;
create policy "warehouses select all" on warehouses
  for select using (true);

-- Public bucket for warehouse photos. Uploads go through the backend's
-- service-role key, so no storage.objects policy is needed for writes.
insert into storage.buckets (id, name, public)
values ('warehouse-photos', 'warehouse-photos', true)
on conflict (id) do nothing;

create policy "warehouse photos public read" on storage.objects
  for select using (bucket_id = 'warehouse-photos');
