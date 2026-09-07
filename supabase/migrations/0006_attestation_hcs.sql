-- Optional on-chain proof pointers for attestations published to Hedera HCS.
alter table attestations
  add column if not exists hcs_topic_id text,
  add column if not exists hcs_sequence_number bigint,
  add column if not exists hcs_transaction_id text;
