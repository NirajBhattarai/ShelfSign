-- Track fraud-slash history separately from the active escrow lock, so
-- restaking (a fresh lock) doesn't erase the audit trail of a prior slash.

alter table cameras
  add column if not exists escrow_forfeited_at timestamptz,
  add column if not exists escrow_slash_tx_id text,
  add column if not exists escrow_slash_hashscan_url text;

comment on column cameras.escrow_forfeited_at is
  'When a CRE SLASH verdict forfeited this camera''s locked USDC bond.';
comment on column cameras.escrow_slash_tx_id is
  'Hedera transaction id that moved the slashed USDC out of the escrow vault.';
