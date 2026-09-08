# ShelfSign × Chainlink CRE — Confidential fraud review

Runs attestation risk scoring inside a **TEE** (`handlerInTee`) so camera host,
fake/fraud flags, and intermediate reasons stay confidential from node operators.
Only `CLEAR` / `HOLD` / `SLASH` + score + `reasonHash` leave the enclave.

## Prize track

ETHOnline **Chainlink → Best Confidential Workflow**

## Setup

1. Install [CRE CLI](https://docs.chain.link/cre/getting-started/cli-installation)
2. Set the same token in backend and CRE:

```bash
# backend/.env
CRE_API_TOKEN=dev-cre-token-change-me

# cre/.env
cp cre/.env.example cre/.env
# SECRET_API_TOKEN=dev-cre-token-change-me
```

3. Apply migration `0011_cre_verdicts.sql`
4. Install workflow deps:

```bash
cd cre/fraud-review && bun install   # or npm install
```

5. Queue a review (any attestation id), then simulate:

```bash
curl -s -X POST http://127.0.0.1:4000/cre/reviews \
  -H 'content-type: application/json' \
  -d '{"attestationId":"<uuid>","requestedBy":"demo"}'

cd cre
cre workflow simulate fraud-review --target staging-settings --non-interactive --trigger-index 0
```

6. Read public verdict:

```bash
curl -s http://127.0.0.1:4000/cre/verdicts/<attestationId>
```

Without CRE CLI, UI can call `POST /cre/reviews/:id/run-local` (same scoring, `source=local`) — use **cre simulate** for the prize submission.

## Confidentiality boundary

| Stays in TEE | Public (DON / DB) |
|---|---|
| `CRE_API_TOKEN` | verdict |
| `cameraHost` | score |
| private reason strings | `reasonHash` |
| raw risk JSON | attestation id |

## Docs

- https://docs.chain.link/cre/concepts/confidential-workflows
- https://docs.chain.link/cre/guides/workflow/using-confidential-workflows/making-workflow-confidential-ts
