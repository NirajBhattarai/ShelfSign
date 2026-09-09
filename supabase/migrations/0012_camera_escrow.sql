-- USDC escrow locked on Hedera when a camera is attached/enrolled.

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
  'Hedera HTS USDC escrow for this camera: locked on enroll.';
comment on column cameras.escrow_amount is
  'Smallest USDC units (6 decimals) locked in the escrow vault.';
