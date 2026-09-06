-- ShelfSign core schema: supplier/buyer accounts, camera registry,
-- attestations, and buy orders. Run against a Supabase project
-- (SQL editor or `supabase db push`).

create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  role text not null check (role in ('supplier', 'buyer')),
  company_name text not null,
  categories text[] not null default '{}',
  created_at timestamptz not null default now()
);

create table warehouses (
  id uuid primary key default gen_random_uuid(),
  supplier_id uuid not null references profiles(id) on delete cascade,
  name text not null,
  location text,
  created_at timestamptz not null default now()
);

create table cameras (
  id uuid primary key default gen_random_uuid(),
  warehouse_id uuid not null references warehouses(id) on delete cascade,
  supplier_id uuid not null references profiles(id) on delete cascade,
  label text not null,
  cmos_account text unique,
  enrollment_status text not null default 'pending'
    check (enrollment_status in ('pending', 'enrolled', 'failed')),
  created_at timestamptz not null default now()
);

-- camera_account is denormalized from cameras.cmos_account at insert time
-- so a public reader can trust an attestation without needing row access
-- to the (owner-only) cameras table.
create table attestations (
  id uuid primary key default gen_random_uuid(),
  camera_id uuid not null references cameras(id) on delete cascade,
  supplier_id uuid not null references profiles(id) on delete cascade,
  camera_account text not null,
  nonce text not null,
  image_cid text,
  image_hash text not null,
  model text not null,
  model_hash text not null,
  items jsonb not null,
  captured_at timestamptz not null,
  created_at timestamptz not null default now()
);

create table buy_orders (
  id uuid primary key default gen_random_uuid(),
  buyer_id uuid not null references profiles(id) on delete cascade,
  supplier_id uuid not null references profiles(id) on delete cascade,
  sku text not null,
  quantity int not null check (quantity > 0),
  attestation_id uuid references attestations(id),
  status text not null default 'pending'
    check (status in ('pending', 'confirmed', 'fulfilled', 'cancelled')),
  created_at timestamptz not null default now()
);

create index cameras_supplier_id_idx on cameras(supplier_id);
create index attestations_supplier_id_idx on attestations(supplier_id);
create index attestations_camera_id_idx on attestations(camera_id);
create index buy_orders_buyer_id_idx on buy_orders(buyer_id);
create index buy_orders_supplier_id_idx on buy_orders(supplier_id);

alter table profiles enable row level security;
alter table warehouses enable row level security;
alter table cameras enable row level security;
alter table attestations enable row level security;
alter table buy_orders enable row level security;

-- profiles: role/company_name/categories are meant to be publicly
-- browsable (buyers browse suppliers by category); only the owner
-- may write their own row.
create policy "profiles select all" on profiles
  for select using (true);
create policy "profiles insert self" on profiles
  for insert with check (auth.uid() = id);
create policy "profiles update self" on profiles
  for update using (auth.uid() = id);

-- warehouses, cameras: owner-only, both read and write. Buyers never
-- need to read these directly — attestations carry what they need.
create policy "warehouses select own" on warehouses
  for select using (auth.uid() = supplier_id);
create policy "warehouses insert own" on warehouses
  for insert with check (auth.uid() = supplier_id);
create policy "warehouses update own" on warehouses
  for update using (auth.uid() = supplier_id);
create policy "warehouses delete own" on warehouses
  for delete using (auth.uid() = supplier_id);

create policy "cameras select own" on cameras
  for select using (auth.uid() = supplier_id);
create policy "cameras insert own" on cameras
  for insert with check (auth.uid() = supplier_id);
create policy "cameras update own" on cameras
  for update using (auth.uid() = supplier_id);

-- attestations: public read (this is the product); no insert/update
-- policy at all — only the backend's service-role key writes these,
-- after running the full verification checklist.
create policy "attestations select all" on attestations
  for select using (true);

-- buy_orders: a buyer sees/creates their own; a supplier sees (not
-- writes) orders addressed to them.
create policy "buy_orders select own" on buy_orders
  for select using (auth.uid() = buyer_id or auth.uid() = supplier_id);
create policy "buy_orders insert own" on buy_orders
  for insert with check (auth.uid() = buyer_id);
