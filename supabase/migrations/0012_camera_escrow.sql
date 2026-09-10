-- Native HBAR escrow locked on Hedera when a camera is attached/enrolled.
-- (Originally drafted as USDC/HTS; product uses ESCROW_TOKEN_ID=0.0.0 / HBAR.)

alter table cameras
  add column if not exists escrow_status text
    check (escrow_status is null or escrow_status in ('locked', 'released', 'forfeited')),
  add column if not exists escrow_amount bigint,
  add column if not exists escrow_token_id text,
  add column if not exists escrow_account_id text,
  add column if not exists escrow_tx_id text,
  add column if not exists escrow_hashscan_url text,
  add column if not exists escrow_locked_at timestamptz;

comment on column cameras.escrow_status is
  'Hedera HBAR escrow for this camera: locked on enroll (token id 0.0.0).';
comment on column cameras.escrow_amount is
  'Tinybars locked in the escrow vault (or legacy HTS smallest units if token id != 0.0.0).';
