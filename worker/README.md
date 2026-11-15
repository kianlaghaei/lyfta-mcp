# Lyfta Personal MCP — Cloudflare Worker

A small personal MCP server built on the official Lyfta Community API. The original upstream Node/Express implementation remains unchanged in the repository root.

## Included tools

- search_exercises
- list_performed_exercises
- get_workout_history (summary or detail)
- get_exercise_progress
- preview_workout_template (local validation only)
- create_program (WRITE, confirm:true)
- create_workout_template (WRITE, confirm:true)
- analyze_muscle_load (approximate training set distribution)
- estimate_recovery (time since last training; NOT Lyfta's recovery percent)

Out of scope: coach-client tools, unauthorized app endpoints, program edits/deletes (not documented by Lyfta), and fake recovery percentages.

## Requirements

Node.js 20+, npm, Wrangler/Cloudflare account. No DB, Auth0 or Docker required.

## Local setup

```powershell
cd C:\Users\k.laghaei\Projects\lyfta-mcp\worker
npm ci
Copy-Item .dev.vars.example .dev.vars
# Edit .dev.vars locally with real values; NEVER commit this file.
npm run check
npm test
npm run dev
```

The local MCP endpoint is http://localhost:8787/mcp; health endpoint is http://localhost:8787/healthz.

Use two distinct secrets: `LYFTA_API_KEY` is generated at https://my.lyfta.app/community/api;
`MCP_ACCESS_TOKEN` is a random bearer credential for MCP callers. Do not send either key in chat or commit it.

## Cloudflare deployment (intentional manual operation)

```powershell
cd C:\Users\k.laghaei\Projects\lyfta-mcp\worker
npx wrangler login
npx wrangler secret put LYFTA_API_KEY
npx wrangler secret put MCP_ACCESS_TOKEN
npm run build
npm run deploy
```

Use `https://<your-worker>.workers.dev/mcp` in an MCP client capable of passing
`Authorization: Bearer <MCP_ACCESS_TOKEN>`. For ChatGPT direct custom connector support,
check current authentication requirements: a fixed Bearer header is NOT equivalent to
OAuth and may need to be replaced with an OAuth gateway.

## Safety model

- Secret values exist only in Worker secrets or the ignored `.dev.vars` local file.
- `/mcp` fails closed without both configured secrets.
- Publishing program or template requires explicit `confirm: true`.
- No automatic retries on POST create requests; duplicate creations are possible.
- Analytical tools use primary and secondary set-count heuristics; no health claims.
- Muscle-load implementation currently processes the first page, with diagnostics.
- No real Lyfta account write has been attempted by this repository setup.
- Public GitHub forks expose source files. Never commit user training data, tokens, or logs.

## Quality gates

```powershell
npm ci
npm run check
npm test
npm run build
```

Start further development from `docs/AGENT_HANDOFF_PROMPT.md` and `docs/API_COVERAGE.md`.
