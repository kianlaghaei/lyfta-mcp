# Interpreting training and recovery-related outputs

All calculations operate on bounded official API reads. Read `completeness` first.
Workouts are date-filtered for both the requested rolling period and the preceding
equal period; IDs deduplicate across overlapping pages. No order-based early stop is
assumed. The shared boundary belongs only to the current period. Date-only/unzoned
snapshot timestamps are interpreted as UTC; explicit offsets are respected. Lyfta's
server-side date filtering uses indexed timeline time, which can differ from snapshot
dates; live integration must check this alignment.

Only `is_completed:true` sets count. Missing/null completion markers stay unknown;
`false` is incomplete. Recorded session counts use the completed-workout endpoint,
while set counts need their own explicit evidence. Missing dates, future dates,
exercise details and metadata are diagnosed. A missing muscle mapping does not erase
the known completed-set count, but prevents confirmed attribution to that muscle.

Volume is external weight × integer repetitions for `weight_reps` sets with a known
kg/lb unit. Units are kept separate; unknown units and unsuitable exercise types are
excluded. This is not mechanical work or total biological stimulus. Raw durations,
distances and workout durations remain available in history; no undocumented distance
unit conversion is performed. Epley 1RM estimates use positive weight and 1–10 reps;
they are uncertain when effort, bodyweight or assistance is unknown. Per-exercise
chronological points retain the unit. Repeated best weights across three exposures
are only a possible plateau observation; planned maintenance/deload is unknown.
PR marker counts summarize nonempty, nonzero source fields, not verified all-time records.
Use Lyfta exercise progress for its own best-set and estimated-RM records.

Each primary muscle receives the associated completed set count. Secondary muscles
receive a configurable weight (default 0.5), explicitly a **heuristic**, not an equal
stimulus. An ID in both groups counts as primary only. Per-workout muscle membership,
Monday-UTC weekly buckets, rolling totals, prior-period changes, frequency, recorded RIR
and last timestamp are returned. Partial edge weeks are not full-week comparisons.
Related-muscle counts are descriptive pairs, not prescribed ideal ratios. Muscles with
no recorded stimulus in the window may be unmapped/unlogged, not necessarily neglected.
Catalog IDs and names come from the official mapping table; unknown IDs remain visible.

`estimate_recovery` separates:

- **Observed:** source completion markers/catalog associations and optional caller self-report.
- **Calculated:** elapsed time since last observed involvement, sets, frequency, RIR summaries and workload changes.
- **Heuristic:** secondary weighting and descriptive repeated exposure indicators.
- **Unavailable:** Lyfta's in-app recovery percentage, physiological recovery, measured readiness and unrecorded training.

Last exposure means last **within retrieved window/coverage**; absence does not imply
never trained. No fixed 24/48-hour threshold establishes recovery. Self-reported soreness,
sleep, fatigue, pain and readiness are transient inputs, not persisted medical records or
validated physiological measures. No recovery percentage, medical conclusion or automated
training clearance is produced. Session target shortfall requires a supplied weekly target;
missed scheduled-session attribution remains unavailable without verified attendance linkage.
