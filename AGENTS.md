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

A deployed MCP must return tools/list, pass tool unit tests, remain protected without secrets,
read real Lyfta exercises and history without exposing credentials, and create a test collection
and template only after user approval. Report API gaps without inventing functionality.
