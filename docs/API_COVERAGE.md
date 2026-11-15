# Lyfta Community API coverage — 2026-11-15

Official source: https://my.lyfta.app/community/api

| Method | Endpoint | Worker tool | Scope |
|---|---|---|---|
| GET | /api/v1/workouts | get_workout_history(detailed), analysis | Personal |
| GET | /api/v1/workouts/summary | get_workout_history | Personal |
| GET | /api/v1/exercises | list_performed_exercises, analysis | Personal |
| GET | /api/v1/exercises/library | search_exercises | Personal |
| GET | /api/v1/exercises/progress | get_exercise_progress | Personal |
| POST | /api/v1/collections | create_program | Personal |
| POST | /api/v1/templates | create_workout_template | Personal |
| GET | /api/v1/clients | NOT IMPLEMENTED | Coach only; intentionally excluded |

Documented limits: 60 requests/minute, 5000/day, detailed workouts max 100/page.
Collection body: { collection: {title, description?, goal?, image?} }.
Template body: { collectionId: integer, workout: {title, exercises: [...] } }.
For exercise templates, catalog-linked IDs, name (legacy `excercise_name`),
type and image must match real catalog. Sets contain string fields like `weight`, `reps`.
The exercise metadata fields `Target_muscles_id`, `Synergist_muscles_id`,
`equipment_id` and `body_part_id` are JSON-serialized arrays of IDs.

NOT DOCUMENTED: get/list existing collections/templates; update/delete existing templates,
finish/log workout sets, in-app recovery percentages, recovery score API, automatic scheduling.
Do not implement these as real Lyfta writes until the official API publishes them.

Known worker gaps to resolve next:
- Full paginated collection of workouts for analytics (currently first page).
- Performed-exercise metadata can also be paginated; inspect response total_pages and collect remaining pages.
- Exercise identity validation against catalog before create.
- Richer structured MCP outputs with output schemas.
- Mechanism for OAuth-compatible client authentication (if needed).
- End-to-end integration tests using a test account and approvals.

Analytical interpretation:
- Primary sets counted once per target muscle; secondary contribution *0.5 is a heuristic.
- Timestamp categories <24h, 24-48h, >48h are NOT recovery percentages or evidence of full recovery.
- Log source may omit unperformed exercises in `/exercises` metadata; report unmatched counts.
