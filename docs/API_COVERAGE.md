# Official API coverage and contract notes — verified 2026-11-15

Authority: [Lyfta Community API](https://my.lyfta.app/community/api). This describes the
current published contract, not verified behavior of the owner's account. No private
endpoint, reverse-engineered login, or real catalog/account call was used in development.
The earlier handoff's claim that collection/template reads were undocumented is obsolete.

| Method / endpoint (`/api/v1`) | Worker coverage | Contract / bounds |
|---|---|---|
| GET `/workouts` | history, all analysis | `page`, `limit` (API max 100), optional inclusive UTC `from`,`to` (YYYY-MM-DD); invalid dates/order → 400. Snapshot timestamp can differ from indexed filter time. |
| GET `/workouts/summary` | history with `detailed:false` | `page`,`limit` (API default 20, max 1000; Worker caps at 100); no documented date filter. Headers only, no exercises/sets. |
| GET `/exercises` | performed catalog, identity checks, muscle metadata | Global list convention accepts `page`,`limit`; endpoint example shows count/current_page/limit, but omits total_pages. Collector continues until metadata exhaustion/empty page or budget; does not assume first page is complete. |
| GET `/exercises/library` | search, identity/metadata fallback | `search`,`limit`,`offset`; defaults/caps not published. `data.results` and `data.pagination:{limit,offset,total,hasMore}`. Worker fetches 50/page, applies local filters, exposes resumable offsets. |
| GET `/exercises/progress` | exercise progress | Required integer `duration` (days), integer `exercise_id` from performed catalog. `data` array plus `weight_unit`; no pagination documented. Worker local duration cap 730. |
| POST `/collections` | complete program creation | `{collection:{title,description?,goal?,image?}}`; trimmed title required; image is raw base64, never URL. `data.id` identifies created record. Image upload follows collection creation, so failures can be partial. |
| POST `/templates` | program and standalone template creation | `{collectionId:integer,workout:{...}}`; collection must belong to owner. Exact catalog ID/name/type/image; legacy `excercise_name`. `data` mirrors saved template, includes ID. |
| GET `/collections`, `/collections/:id` | saved library/readback | List `page`,`limit`; detail `view=summary` (default) or `full`. Pagination fields and `collections` list; detail `data` object. Full includes template JSON. |
| GET `/templates`, `/templates/:id` | saved library/readback | List `page`,`limit`, `templates` plus page metadata; singular `data` includes exercises/sets. Defaults/caps not published; Worker max 100 for lists. |
| GET `/schedule` | saved library resource `schedule` | Optional UTC `from` (today), `to` (+90 days), `include_completed=false`; source calendar/followed plan. Response workouts + pagination (example limit 50). Global list convention supplies page/limit; live acceptance should verify this route honors them. No schedule writes. |
| GET `/me` | saved library resource `me` | Plain `{id:number}`; explicitly validated exception to `status` envelope. |
| GET `/profile` | saved library resource `profile` | `status,message,data` with personal profile and counts. No coach parameter exposed. |
| GET `/feed`, `/feed/home` | Explicitly excluded | Newly documented social feeds are outside personal program/history/progression objectives. |
| GET `/clients`, any `client_id`/`clientId` | Explicitly excluded | Coach functionality; rejected by strict tool schemas. |

## Response normalization and errors

Successful personal routes normally have boolean `status`; false/missing status is an
error except `/me`. Detailed workout pages have `workouts` and optional `count`,
`total_records`, `total_pages`, `current_page`, `limit`. IDs can be strings or numbers;
normalized catalog IDs are decimal strings. Counts/page metadata, when present, must
be valid numbers; missing metadata remains unknown. Overlapping IDs are deduplicated.
Repeated pages and page-number mismatches stop with incomplete diagnostics. A later
upstream failure returns an error instead of silently presenting preceding pages as complete.

Workout `exercises[].sets[]` include string/number measures, optional boolean completion,
RIR, duration/distance and record fields. Optional/null snapshot fields are preserved as
unknown, not defaulted to zero/completed. `weight_unit` must be kg/lb/null/unset.
Unexpected non-null units fail validation instead of being combined. `excercise_name`
is intentional. Exercise metadata arrays are JSON strings or decoded ID arrays; invalid
arrays receive diagnostics, unknown IDs are retained with null labels. Official equipment,
body-part and muscle tables are used, including legacy labels such as Serratus Ante.

Rate limits are 60/minute and 5,000/day. Docs specify 429 and textual API-key/validation
errors but do not define one exhaustive status-code/error-body schema. The adapter handles
400/401/403/404/429/5xx, network timeout, invalid JSON, false-status and incomplete envelopes;
it never forwards arbitrary upstream bodies/messages that might contain credentials.
`Retry-After` is reported and only short valid delays are retried for GET. POST failures
can have uncertain effects; no create retry/idempotency guarantee is inferred.

## Template contract decisions

The published tables require all four exercise identity fields, although some minimal
examples omit image. This Worker follows the stricter table and checks exact live values.
Library `exercise_type:null` does not authorize inventing a type: use a non-null performed
or library record, otherwise preview/write fails closed. An empty string type is accepted
only if it exactly matches a non-null catalog value. Local bounded lookup can reject a
valid exercise it cannot reach; it must never falsely certify one.

Supported useful fields, string measures, superset/range rules, preview and write schemas
are documented once in [WORKER_TOOLS.md](WORKER_TOOLS.md). Server-assigned identity/dates,
legacy workout ID, coach selection and arbitrary unknown fields are not writable.
No weight-unit override is documented for templates; owner preference must be reviewed.
Duration/distance storage is preserved; undocumented unit semantics are not invented.

## Remaining public API limitations

No documented update/delete, transaction/rollback, create idempotency key, workout completion
write, full in-app recovery percentage or physiological readiness endpoint. Null catalog
types and incomplete exercise metadata constrain validation/analytics. No exhaustive
defaults/caps are published for several list/search routes. Snapshot and indexed dates
can differ. Bounded scans cannot prove no training or full catalog coverage. Live key,
schema/units/pagination, an approved write/readback, and actual client compatibility remain
owner-gated verification steps in [worker/README.md](../worker/README.md).
