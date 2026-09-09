-- Classical PRNU sensor-noise correlation score (vision-service/src/cmos/prnu.py),
-- alongside the existing pixel-stability cmos_score on each attestation.
alter table attestations
  add column if not exists prnu_score double precision;

comment on column attestations.prnu_score is
  'Normalized cross-correlation between this capture''s noise residual and '
  'the camera''s enrolled PRNU fingerprint. Null if the camera predates PRNU '
  'enrollment (no fingerprint on file yet).';
