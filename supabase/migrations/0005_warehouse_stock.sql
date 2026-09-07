-- Supplier-declared orderable inventory. Attestations stay camera proof
-- (CMOS score + YOLO detections as evidence) and must not overwrite these
-- quantities — vision can miss shadowed / background items.

create table warehouse_stock (
  id uuid primary key default gen_random_uuid(),
  warehouse_id uuid not null references warehouses(id) on delete cascade,
  supplier_id uuid not null references profiles(id) on delete cascade,
  sku text not null,
  quantity int not null check (quantity >= 0),
  shelf text not null default '',
  updated_at timestamptz not null default now(),
  unique (warehouse_id, sku)
);

create index warehouse_stock_warehouse_id_idx on warehouse_stock(warehouse_id);
create index warehouse_stock_supplier_id_idx on warehouse_stock(supplier_id);
create index warehouse_stock_sku_idx on warehouse_stock(sku);

alter table warehouse_stock enable row level security;

-- Public read so buyers can browse declared stock via API; writes only
-- through the backend service role (no insert/update policies for clients).
create policy "warehouse_stock select all" on warehouse_stock
  for select using (true);

-- Persist silicon score + raw YOLO box count on each attestation for buyers.
alter table attestations
  add column if not exists cmos_score double precision,
  add column if not exists detection_count int;
