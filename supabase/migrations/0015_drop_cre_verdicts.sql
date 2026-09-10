-- Remove Chainlink CRE confidential fraud-review tables.

drop policy if exists "cre_verdicts select all" on cre_verdicts;
drop index if exists cre_verdicts_attestation_idx;
drop index if exists cre_reviews_pending_idx;
drop table if exists cre_verdicts;
drop table if exists cre_reviews;
