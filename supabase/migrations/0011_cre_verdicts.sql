-- HISTORICAL: Chainlink CRE confidential fraud reviews (removed in 0015).
-- Kept so migration history stays applyable; do not reintroduce CRE.
-- Chainlink CRE confidential fraud reviews (public verdict only; raw risk
-- payloads stay inside the TEE and are never stored here).

create table if not exists cre_reviews (
  id uuid primary key default gen_random_uuid(),
  attestation_id uuid not null references attestations(id) on delete cascade,
  camera_id uuid not null references cameras(id) on delete cascade,
  status text not null default 'pending'
    check (status in ('pending', 'running', 'completed', 'failed')),
  requested_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists cre_verdicts (
  id uuid primary key default gen_random_uuid(),
  review_id uuid references cre_reviews(id) on delete set null,
  attestation_id uuid not null references attestations(id) on delete cascade,
  camera_id uuid not null references cameras(id) on delete cascade,
  verdict text not null check (verdict in ('CLEAR', 'HOLD', 'SLASH')),
  score int not null,
  reason_hash text not null,
  source text not null default 'cre'
    check (source in ('cre', 'cre_sim', 'local')),
  created_at timestamptz not null default now()
);

create index if not exists cre_reviews_pending_idx
  on cre_reviews (status, created_at)
  where status = 'pending';

create index if not exists cre_verdicts_attestation_idx
  on cre_verdicts (attestation_id, created_at desc);

alter table cre_reviews enable row level security;
alter table cre_verdicts enable row level security;

create policy "cre_verdicts select all" on cre_verdicts
  for select using (true);

-- Reviews are service-role only (CRE + backend); no public policies for insert.
comment on table cre_verdicts is
  'Public CRE confidential-workflow outcomes. Sensitive risk inputs never leave the TEE.';
