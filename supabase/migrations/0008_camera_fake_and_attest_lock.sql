-- Demo / anti-fraud camera metadata + single-flight attest lock.
-- is_fake: UI flag sourced from DB (fake-cam stub vs real CMOS).
-- attest_locked_*: only one concurrent attest/count-live per camera until it finishes.

alter table cameras
  add column if not exists is_fake boolean not null default false;

alter table cameras
  add column if not exists attest_locked_at timestamptz;

alter table cameras
  add column if not exists attest_locked_by text;

comment on column cameras.is_fake is
  'True when this row points at a non-sensor / stub stream (e.g. fake-cam). Shown in supplier camera UI.';
comment on column cameras.attest_locked_at is
  'Set while runFullAttestation is in progress; cleared when finished (pass or fail).';
comment on column cameras.attest_locked_by is
  'User id (or system) holding the attest lock.';
