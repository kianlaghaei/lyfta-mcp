# Worker engineering handoff

Work on `feat/cloudflare-personal-mcp` in `worker/`. Read root `AGENTS.md`,
[Worker README](../worker/README.md), [coverage](API_COVERAGE.md), and current official docs
before changes. Preserve root upstream Node implementation and LICENSE. Never inspect
secret files merely to establish setup status. Do not deploy or perform real Lyfta writes
without explicit owner authorization. A green synthetic suite does not prove live integration.

## Module ownership

| Module | Responsibility |
|---|---|
| `index.ts` | Fail-closed Bearer auth, Origin guard, per-request SDK HTTP handler and body cap |
| `lyfta-client.ts` | Bounded streamed reads, timeouts/budgets, sanitized errors, GET-only retries, endpoint adapters |
| `contracts.ts` | Runtime response contracts, null/unknown fields and numeric/string ID compatibility |
| `schema.ts` | Strict local creation safeguards and documented write fields |
| `history.ts` | Bounded pagination, stable-ID deduplication, explicit completeness |
| `catalog.ts` | ID decoding, verified equipment/body-part tables, local filters and cursor continuation |
| `program.ts` | Exact catalog validation, expiring payload-bound receipts, sanitized failure classification |
| `analysis.ts` | Verified muscle table, UTC normalization, completion evidence, period/unit-separated analytics |
| `server.ts` | 12 tools, read/write hints, structured bounded output, partial-create orchestration |

## Validation

From `worker/`: `npm ci`, `npm run check`, `npm test`, `npm run build`, `npm run smoke:local`.
`npm run smoke:local` launches actual local workerd with synthetic secrets; it never calls Lyfta.
Unit/HTTP tests use realistic synthetic fixtures only. CI performs these steps; inspect the
workflow result on the final source SHA. Do not report a prior-SHA run as evidence for new changes.
The Vitest upgrade removes the baseline development-tool audit advisories.

## Important invariants and live gates

- Only explicit `is_completed:true` sets count. Unknown completion/units/dates stay unknown.
- No first-page completeness assumption, no summed kg/lb, no invented recovery/readiness score.
- Every creation requires live catalog checks, an unchanged signed preview, and `confirm:true`
  after human intent. The receipt is replayable during ten minutes; no exactly-once claim.
- Never retry POST. Partial/unknown creates require saved-library readback; public delete/rollback
  and idempotency keys are unavailable. Preserve every known created ID.
- ChatGPT cannot provide this private static token directly. OAuth gateway is documented, not
  implemented; do not remove auth or claim tested ChatGPT compatibility. See [auth](WORKER_AUTH.md).
- Live account read acceptance, approved write/readback, deployment, and authenticated real-client
  sessions remain owner-gated. Complete independent development tasks before requesting access.
- Reverify official docs: collection/template reads, profile/me and schedule now exist; social
  feeds and all coach operations remain deliberately out of scope.

Developer testing/troubleshooting: [Worker README](../worker/README.md).
Analytics assumptions: [interpretation](WORKER_ANALYTICS.md). Tool contract: [reference](WORKER_TOOLS.md).
