# Worker MCP tools

All 12 tools require Bearer authentication. Inputs are strict; omitted defaults are
shown below. Success is `{content:[{type:"text",text:"..."}],structuredContent:{data:{...}}}`.
Failures use `isError:true` and sanitized JSON text with status/retry/uncertain-write fields
when applicable. Protocol/schema errors can be generated directly by the MCP SDK.
Responses are byte-bounded; no silent output truncation. Machine consumers must inspect
pagination and creation status before summarizing success.

| Tool | Inputs | Behavior |
|---|---|---|
| `search_exercises` | `search=""`, `limit=20` (1–100), `offset=0`, `max_pages=5` (1–10); optional `equipment_id`, `body_part_id`, `primary_muscle_id`, `secondary_muscle_id` (decimal ID strings) | Text goes to Lyfta; filters run locally, all supplied filters must match. Returns normalized identity, decoded arrays and missing fields; resume at `next_offset`. Coverage covers only fetched pages. |
| `list_performed_exercises` | `max_pages=5` (1–10) | Deduplicated metadata, at most 100 records per page, with completion diagnostics. |
| `get_workout_history` | `page=1`, `limit=30` (1–100), `max_pages=5`, `detailed=true`, optional `from`,`to` UTC YYYY-MM-DD | Bounded detail or summary pages. Date filters require detail. Returns raw measures/completion evidence and pagination diagnostics. |
| `get_exercise_progress` | `exercise_id` positive decimal string, `duration_days=90` (1–730) | Lyfta best-set records and reported kg/lb. Duration limit is a local guard, not an asserted API cap. |
| `get_saved_library` | `resource`: `collections`, `collection`, `templates`, `template`, `schedule`, `profile`, `me`; `id` for singular records; `page=1`,`limit=20` (1–100); `view=summary` or `full` for a collection; optional schedule `from`,`to`,`include_completed=false` | One page or one record. Read list pagination and call subsequent pages explicitly. Profile/owner are personal only. |
| `preview_program` | `collection`, `workouts` (1–8 templates) | Schema and catalog checks; summaries and signed receipt; no POST. |
| `create_program` | Exact preview `collection`,`workouts`, `preview_token`,`confirm:true` | **Write**: collection, then ordered templates; stops at first failure. Reports partial/uncertain result and unattempted titles. |
| `preview_workout_template` | `collection_id` positive integer, `workout` | Reads collection and catalog, validates and signs exact target/payload. |
| `create_workout_template` | Same target/workout, `preview_token`,`confirm:true` | **Write**: one POST after live identity recheck. Uncertain failure requires readback. |
| `analyze_training` | `days=14` (1–90), `max_pages=5`, `secondary_weight=0.5` (0–1), optional `expected_weekly_sessions` (0–21) | Current/previous periods, frequency, sets, reps, unit-separated volume, exercise trends, muscle distributions. |
| `analyze_muscle_load` | Same analysis inputs | Focused per-workout, rolling/weekly muscle involvement and prior-period differences. |
| `estimate_recovery` | Same analysis inputs; optional `self_report:{soreness:0..10,sleep_hours:0..24,fatigue:0..10,pain:string,perceived_readiness:0..10}` | Observed/calculated/heuristic/unavailable layers, no recovery percentage/readiness score. Self-report is returned only for this call; no storage. |

## Creation example (synthetic; exercise identity must be verified live)

Call `preview_program`:

```json
{
  "collection": {"title":"Two-day strength", "goal":"strength"},
  "workouts": [{
    "title":"Lower body",
    "description":"Review volume with the user",
    "exercises":[{
      "exercise_id":31,
      "excercise_name":"Rear Lunge",
      "exercise_type":"weight_reps",
      "exercise_image":"https://apilyfta.com/static/GymvisualPNG/00781101-Barbell-Rear-Lunge_Thighs_small.png",
      "exercise_rest_time":120,
      "is_rep_range_active":true,
      "sets":[{"set_type_id":0,"from_reps":"8","to_reps":"10","weight":"","rir":"2"}]
    }]
  }]
}
```

After showing the full validated preview and obtaining confirmation, call `create_program`
with the same object plus the returned `preview_token` and `confirm:true`.
Never fabricate catalog values or reuse the synthetic image if the live catalog differs.
If a receipt expires or a field changes, preview again.

Template exercise fields: required integer `exercise_id`, legacy-spelled `excercise_name`,
`exercise_type`, `exercise_image`, `sets` (1–30). Optional `exercise_note`, integer rest
seconds, integer superset group (0 means none), and boolean rep-range switch. All set
measures are nonnegative decimal strings (rep counts/range bounds are integer strings),
or empty strings to leave unset. `set_type_id` is an integer; only 0 has documented normal
semantics. Fields: `reps`, `from_reps`, `to_reps`, `weight`, `rir`, `duration`, `distance`.
Both bounds are mandatory in range mode and lower cannot exceed upper. No invented
set-type enumeration or exercise-type enumeration is imposed.

Optional workout fields: `description`, `note`, hex `color`, `picture` (base64 image data
URI or Lyfta CDN HTTPS URL). Collection accepts `description`, `goal`, `image` (raw base64,
not URL). Image strings have a 100 KB local guard; overall HTTP payload is capped at 512 KB.
Workouts require a nonblank title, 1–30 exercises; these are intentional local safety
constraints stricter than Lyfta's permissive empty-template defaults. Up to 20 distinct
exercise identities may be checked per program. Catalog resolution is bounded to three
performed pages and two library pages per missing identity; unresolved values block writes.
Server-owned ID/date/user and coach fields are excluded from create input.
