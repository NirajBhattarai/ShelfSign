-- Hackathon catalog: only Chair / Monitor / Table for warehouse tagging
-- and buyer filters. Replaces the broad seed list from 0002.

delete from categories;

insert into categories (name) values
  ('Chair'),
  ('Monitor'),
  ('Table');
