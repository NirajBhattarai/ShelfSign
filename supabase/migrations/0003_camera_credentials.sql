-- Camera access details, needed so the vision service can actually connect
-- to a supplier's camera and run real CMOS/PUF enrollment (previously only
-- a label was collected and enrollment was a stub with no real hardware
-- access). Stored in plaintext: the service-role backend is already this
-- project's trust boundary (see profiles/warehouses RLS), and this is a
-- hackathon prototype, not a production credential store.

alter table cameras add column host text;
alter table cameras add column username text;
alter table cameras add column password text;
