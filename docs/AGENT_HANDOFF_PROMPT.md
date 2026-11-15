# Development Agent Handoff — Lyfta Personal MCP

You are taking over development of the `kianlaghaei/lyfta-mcp` fork on branch
`feat/cloudflare-personal-mcp`, working directory `worker/`.
The goal is a **single-user** Cloudflare Worker serving Streamable HTTP MCP and
the documented Lyfta Community REST API. This is not a coaching SaaS.

Existing baseline:
- Upstream source is preserved in root and its MIT license must be retained.
- `worker/src/index.ts`: a bearer-protected MCP endpoint `/mcp` and `/healthz`.
- `worker/src/lyfta-client.ts`: official API adapter.
- `worker/src/server.ts`: MCP tools for search/read/write and analytics.
- `worker/src/analysis.ts`: muscle workload and time-since-last-training heuristic.
- `worker/src/schema.ts`: validated creation payloads.
- Tests + CI + Wrangler config. No secrets configured and no production deployment.

Priorities (in order):
P0. Run `npm ci`, `npm run check`, `npm test`, `npm run build`.
Fix all real errors without weakening types. Preserve Workers runtime compatibility.
P1. Add a proper API catalog identity check for templates. Where `exercise_type` is null in library results,
resolve from performed exercises or require explicit input; never invent identity values.
P2. Implement bounded pagination for analysis and data-quality diagnostic indicators.
P3. Add isolated mock tests for MCP tool input schemas, explicit write confirmation,
auth fail-closed behavior, HTTP transport initialization, GET/POST request handling and 429.
P4. Improve analysis: classify exercise body parts, primary/secondary distribution,
weekly comparisons, per-exercise trends, volume and time since training. Label heuristics.
P5. Decide on ChatGPT connector compatibility: if OAuth is required, add a minimal authorized
OAuth flow/gateway with least privilege. Do not assume static Bearer alone works.
P6. Prepare integration smoke tests gated on real secrets, with writes NEVER enabled by default.
P7. After user approval, use Wrangler secrets and deploy to user's Cloudflare account; validate
the real MCP endpoint and Lyfta operations, with no secrets in logs.

Acceptance:
- No unapproved or undocumented Lyfta endpoints or coach functionality.
- No invented 'Lyfta recovery' number; actual in-app percentage is not public API.
- No raw tokens in source, CI, logs, or GitHub.
- A tool that creates records requires user intent and confirm:true.
- Accurate typing and reliable error handling with tests, clear rate limits, backoff on safe reads.
- Graceful behavior for missing muscle metadata and incomplete pagination.
- Production endpoint protected with authentication compatible with chosen MCP clients.
- Document usage and troubleshooting succinctly in README.

Useful references:
https://my.lyfta.app/community/api
https://developers.cloudflare.com/agents/model-context-protocol/apis/handler-api/
https://github.com/jkronlachner/lyfta-mcp

When complete, provide a changed-file summary, test outcomes, API limitations and
deployment checklist. Do not claim production readiness until a real integration test passes.
