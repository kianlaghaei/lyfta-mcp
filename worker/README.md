# Lyfta Personal MCP Worker

Single-owner MCP on Cloudflare Workers. No database, sessions, frontend, OAuth service,
coach accounts, or paid infrastructure is required for Bearer-capable clients.
The independent upstream Node/Express source and MIT license remain in the repository root.

## Setup and checks

Use Node 24 and the committed npm lockfile. From `worker/`:

```powershell
npm ci
npm run check
npm test
npm run build
npm run smoke:local
```

`build` is a **dry run**. `smoke:local` launches and stops local workerd on port 8788
with synthetic credentials. It exercises health, authorization, 2025 initialize, modern
2026 tool listing, all 12 tools' discovery/output schemas and invalid-write rejection.
It makes no Lyfta requests.
Set `SMOKE_PORT` if that port is in use. CI repeats these checks on Linux.

For deliberate local integration with your account:

```powershell
Copy-Item .dev.vars.example .dev.vars
# Edit .dev.vars privately with your existing key and an independent random MCP token.
npm run dev
```

Endpoint: `http://127.0.0.1:8787/mcp`; health: `/healthz`. `.dev.vars` is ignored.
Never send credentials in chat, command-line arguments, commits, screenshots, or logs.
`MCP_ACCESS_TOKEN` must contain at least 32 characters; use cryptographically random bytes.

## Design and use

The SDK v2 `createMcpHandler` serves modern requests and stateless 2025 Streamable HTTP
fallbacks. Each HTTP request owns its client/server; subscription streams are disabled.
Successful tools return `structuredContent.data` plus equivalent JSON text.
All schemas reject unknown input keys. HTTP request cap: 512,000 bytes; tool output cap:
750,000 bytes; each upstream response: 2 MB; aggregate upstream responses: 8 MB.
Each call permits at most 36 upstream attempts and starts no new request after 25 seconds;
each active fetch/body has an 8-second timeout. End-to-end duration can exceed 25 seconds
by the final active fetch timeout. Narrow history windows/page budgets on large accounts.

GET failures due to network errors, 429 or 5xx may retry twice with 200/400 ms backoff.
Valid `Retry-After` values up to two seconds are honored; longer waits are returned to
the caller. Other 4xx, invalid JSON and contract failures do not retry. POST never retries.
Lyfta's account-wide rate limits still apply across parallel clients; this stateless
Worker does not claim a globally synchronized rate limiter.

Program workflow:

1. Discover real catalog exercises; have the assistant design workouts from user requirements.
2. Call `preview_program` with `collection` and `workouts`. Catalog ID/name/type/image
   must match, and set counts, ranges and supersets are checked or summarized.
3. Show the returned preview, warnings, units and workload to the user.
4. Only after explicit confirmation, call `create_program` with the unchanged payload,
   its `preview_token`, and `confirm:true` before the receipt expires in ten minutes.
5. Inspect `write_status`, created records and any failure. On partial/uncertain results,
   read back the collection before deciding how to proceed. Never repeat the whole program.

For one template in an existing collection, use `preview_workout_template` then
`create_workout_template`. Every create call rechecks live catalog identity.
Receipts bind payload and target, but are **not one-time idempotency keys**. Replaying a
confirmed request can duplicate records. The public API has no documented idempotency
key or rollback/delete operation. Human intent cannot be inferred by the server;
MCP clients must honor the explicit confirmation requirement.

See [tools and examples](../docs/WORKER_TOOLS.md), [API contracts/coverage](../docs/API_COVERAGE.md),
[authentication and clients](../docs/WORKER_AUTH.md), and [analytics interpretation](../docs/WORKER_ANALYTICS.md).

## Deployment checklist — owner-authorized operation only

The engineering checks do not establish live Lyfta or ChatGPT compatibility. No production
deployment or real account read/write is performed by tests or CI.

1. Pull `feat/cloudflare-personal-mcp`; run every check above on the exact commit.
2. Review `wrangler.jsonc` Worker name, compatibility date, target Cloudflare account and
   observability. No storage bindings are needed. Logs/traces are enabled; never add
   Authorization headers, request payloads or workout data to application logs.
3. After deployment authorization, sign in and set secrets interactively:

```powershell
npx wrangler login
npx wrangler whoami
npx wrangler secret put LYFTA_API_KEY
npx wrangler secret put MCP_ACCESS_TOKEN
npm run deploy
```

Use the **existing owner's Lyfta API key** from their password manager. If none exists,
the owner must obtain one themselves from the [official API page](https://my.lyfta.app/community/api).
Generating a new Lyfta key revokes the previous key; this project never does that.
`secret put` changes remote configuration and can create a new version; it belongs
inside the authorized deployment boundary. See [Cloudflare secrets](https://developers.cloudflare.com/workers/configuration/secrets/).

4. Set `MCP_URL=https://<worker-host>` and `MCP_ACCESS_TOKEN` through a secure process
   environment, then run `npm run smoke` (the smoke script appends `/mcp`). It never reads
   workouts or writes Lyfta data. A 200 health response alone is not an integration check.
5. Connect a Bearer-capable client using [the client setup](../docs/WORKER_AUTH.md).
6. Owner-authorized live read checks: `get_saved_library(resource:me)`, performed exercises,
   catalog search, a small detailed history page, and exercise progress. Inspect locally;
   do not upload personal responses to GitHub. Confirm timezone, units and schema diagnostics.
7. A real collection/template test needs **separate explicit approval**. Preview first,
   confirm, create once, then read back full collection/template IDs. There is no public rollback.

Direct ChatGPT connection is a separately gated OAuth integration, documented in
[WORKER_AUTH.md](../docs/WORKER_AUTH.md). Never remove Bearer authorization to make linking succeed.

## Troubleshooting

| Symptom | Action |
|---|---|
| 503 | Both secrets must exist; MCP token length must be at least 32. Health is intentionally independent. |
| 401 | Send the independent MCP token, not the Lyfta key. Restart clients after changing their environment. |
| 403 | Cross-origin browser calls are rejected. Use a server-side MCP client. |
| 405 on GET/DELETE | Stateless 2025 transport has no session stream/delete; use POST Streamable HTTP. |
| 413 / output budget | Reduce page count, history limit, program size or images. A create may already exist; read back before repeating. |
| Lyfta 401/403 | Owner verifies existing API key and account permissions locally. Do not expose the upstream body. |
| 429 / request budget | Respect retry-after; serialize calls, narrow scope, wait before a new read. Never retry an uncertain write. |
| Catalog type null / mismatch | Resolve through performed catalog or library. Creation fails closed when exact identity cannot be verified. |
| Incomplete analysis | Read diagnostics; narrow by date or page manually. Missing data is not zero training. |
| Windows EPERM during tools | Run checks in an authorized normal terminal; sandbox temp/log permissions can block Vitest/Wrangler. |
| ChatGPT cannot link | Static custom API keys are unsupported; complete the OAuth gateway acceptance steps. |

Developer module map and live acceptance gates: [handoff](../docs/AGENT_HANDOFF_PROMPT.md).
