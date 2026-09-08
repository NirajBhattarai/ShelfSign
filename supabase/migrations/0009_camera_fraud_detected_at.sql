-- When live attest detects CMOS/signature fraud, persist timestamp for UI.
alter table cameras
  add column if not exists fraud_detected_at timestamptz;

comment on column cameras.fraud_detected_at is
  'Set when refresh/attest fails with cmos_mismatch or signature_invalid.';
