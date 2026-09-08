-- Drop unused IPFS image CID column. Attestations rely on image_hash + HCS.
alter table attestations
  drop column if exists image_cid;
