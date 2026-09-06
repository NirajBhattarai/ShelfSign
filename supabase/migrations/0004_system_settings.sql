-- Backend-owned service config (camera defaults, vision URL, etc.).
-- Secrets and connection details live here — never on the frontend.
-- Seed via `npm run seed:camera-settings` in backend/ (reads env → upserts).

create table system_settings (
  key text primary key,
  value text not null,
  updated_at timestamptz not null default now()
);

alter table system_settings enable row level security;
-- No policies: only the backend service-role key reads/writes this table.

comment on table system_settings is
  'Internal ShelfSign config. Keys include hikvision_host, hikvision_user, '
  'hikvision_pass, vision_service_url. Frontend never sees these values.';
