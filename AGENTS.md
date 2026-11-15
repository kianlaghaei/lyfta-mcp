# Agent development instructions

Repository is a fork of jkronlachner/lyfta-mcp (MIT). The `worker/` folder is our personal Cloudflare Worker target; do not rewrite or remove the upstream Node/Express implementation without explicit reason.

## Goal

Personal Lyfta integration ONLY. No coach or multi-tenant functionality.
Build and inspect workout programs, templates, exercise catalog, logged training, progress,
muscle involvement and time-based recovery proxies using **documented** Lyfta API endpoints.
Recovery percent inside the Lyfta app is not in the public API; do not manufacture it.

## Mandatory approach

1. Read `worker/README.md`, `docs/API_COVERAGE.md`, and `docs/AGENT_HANDOFF_PROMPT.md`.
2. Verify current Lyfta API docs: https://my.lyfta.app/community/api and Cloudflare Workers MCP docs.
3. Work in `worker/`, preserve independent API key and MCP access-token secrets.
4. All operations that create data require explicit user confirmation and tests.
5. Do not ask for the Lyfta API key in chat; use `wrangler secret put` and ignored local dev vars.
6. No undocumented private Lyfta endpoints, reverse-engineered login sessions, or client-account features.
7. Before any deployment, run `npm run check`, `npm test`, `npm run build`.
8. Do not deploy, generate keys, or write to live Lyfta until instructed.
9. Prefer small incremental commits. Keep tests and docs consistent with tool behavior.
10. Any ChatGPT connector design needs explicit verification of client auth support; Bearer header alone may not work.

## Definition of done

Engineering readiness requires strict check, synthetic tests, dry-run build and local workerd
smoke on the final SHA, pushed branch and verified GitHub CI, current docs and an explicit list
of live gates. Production acceptance additionally requires authorized real Lyfta reads,
separately approved creation/readback and an authenticated client session. Never conflate them.

## Worker development rules

- Use Node 24 and `worker/package-lock.json`; root package is the independent upstream project.
- Run `npm ci`, `npm run check`, `npm test`, `npm run build`, `npm run smoke:local` in `worker/`.
- Keep response contracts and strict tool/write schemas synchronized. Unknown is not zero;
  only `is_completed:true` sets enter completed-set metrics. Preserve kg/lb separation.
- All automatic retries are GET-only. Never promise idempotency: signed previews bind content,
  but do not prevent replay. Return known created IDs and uncertain/partial outcomes.
- Do not add undocumented coach fields, private endpoints, persistent storage or OAuth services
  to work around contract gaps. The documented OAuth gateway is a separate integration gate.
- Read `docs/WORKER_TOOLS.md`, `docs/WORKER_AUTH.md`, and `docs/WORKER_ANALYTICS.md` for the
  authoritative tool, client and interpretation conventions; avoid duplicating their contracts.
- Preserve real user data/secrets outside fixtures, outputs, commits and GitHub descriptions.
