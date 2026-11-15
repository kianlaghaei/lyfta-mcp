import type {CatalogExercise, LoggedWorkout, LoggedSet} from "./contracts.js";
import {decodeIds} from "./contracts.js";
export type PerformedExercise = Partial<CatalogExercise>;
export type PerformedWorkout = Partial<LoggedWorkout>;
export const MUSCLES: Record<string, string> = {
  "2":"Adductor Longus","3":"Adductor Magnus","4":"Biceps Brachii","5":"Brachialis","6":"Brachioradialis",
  "7":"Deep Hip External Rotators","8":"Deltoid Anterior","9":"Deltoid Lateral","10":"Deltoid Posterior",
  "11":"Erector Spinae","12":"Gastrocnemius","13":"Gluteus Maximus","14":"Gluteus Medius","15":"Gluteus Minimus",
  "16":"Gracilis","17":"Hamstrings","18":"Iliopsoas","19":"Infraspinatus","20":"Latissimus Dorsi",
  "21":"Levator Scapulae","22":"Obliques","23":"Pectineous","24":"Pectoralis Major Clavicular Head",
  "25":"Pectoralis Major Sternal Head","26":"Popliteus","27":"Quadriceps","28":"Rectus Abdominis","29":"Sartorius",
  "30":"Serratus Ante","31":"Serratus Anterior","32":"Soleus","33":"Splenius","34":"Sternocleidomastoid",
  "35":"Subscapularis","36":"Tensor Fasciae Latae","37":"Teres Major","38":"Teres Minor","39":"Tibialis Anterior",
  "40":"Transverse Abdominis","41":"Trapezius Lower Fibers","42":"Trapezius Middle Fibers","43":"Trapezius Upper Fibers",
  "44":"Triceps Brachii","45":"Wrist Extensors","46":"Wrist Flexors"
};
export function ids(value: unknown) {return decodeIds(value).ids;}
const DAY = 86_400_000;
export function timeOf(value: unknown): number {
  if (typeof value !== "string") return NaN;
  let raw = value.trim().replace(" ", "T");
  if (!/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})?)?$/.test(raw)) return NaN;
  const date = raw.slice(0, 10), midnight = Date.parse(date + "T00:00:00Z");
  if (!Number.isFinite(midnight) || new Date(midnight).toISOString().slice(0, 10) !== date) return NaN;
  if (raw.length === 10) raw += "T00:00:00Z";
  else if (!/(?:Z|[+-]\d{2}:\d{2})$/.test(raw)) raw += "Z";
  return Date.parse(raw);
}
export function numeric(value: unknown): number | null {
  if (value == null || value === "" || typeof value === "string" && !/^\d+(?:\.\d+)?$/.test(value)) return null;
  if (typeof value !== "string" && typeof value !== "number") return null;
  const n = Number(value); return Number.isFinite(n) && n >= 0 ? n : null;
}
function weekOf(timestamp: number) {
  const d = new Date(timestamp); d.setUTCHours(0, 0, 0, 0); d.setUTCDate(d.getUTCDate() - (d.getUTCDay() + 6) % 7);
  return d.toISOString().slice(0, 10);
}
export function analyzeMuscles(workouts: PerformedWorkout[], catalog: PerformedExercise[], days = 14, now = new Date(), secondaryWeight = 0.5) {
  const metadata = new Map(catalog.map(ex => [String(ex.id), ex]));
  const load = new Map<string, {primary: number; secondary: number; last: number; lastId: string | number | null; sessions: Set<string>; weeks: Map<string, {direct: number; indirect: number}>; rir: number[]}>();
  const perWorkout: {id: string | number | null; timestamp: string; primary_muscles: string[]; secondary_muscles: string[]; completed_sets: number}[] = [];
  const diagnostics = {window_days: days, analyzed_workouts: 0, counted_sets: 0, unmatched_exercises: 0,
    missing_primary_mappings: 0, missing_secondary_mappings: 0, unknown_completion_sets: 0, incomplete_sets: 0,
    invalid_dates: 0, future_dates: 0, missing_exercise_details: 0, known_exercise_catalog_size: catalog.length};
  const lower = now.getTime() - days * DAY;
  for (const workout of workouts) {
    const timestamp = timeOf(workout.workout_perform_date);
    if (!Number.isFinite(timestamp)) {diagnostics.invalid_dates++; continue;}
    if (timestamp > now.getTime()) {diagnostics.future_dates++; continue;}
    if (timestamp < lower) continue;
    diagnostics.analyzed_workouts++;
    if (!workout.exercises?.length) diagnostics.missing_exercise_details++;
    const primaryIds = new Set<string>(), secondaryIds = new Set<string>();
    let completed = 0;
    for (const exercise of workout.exercises ?? []) {
      const sets = (exercise.sets ?? []).filter(s => s.is_completed === true);
      diagnostics.unknown_completion_sets += (exercise.sets ?? []).filter(s => s.is_completed == null).length;
      diagnostics.incomplete_sets += (exercise.sets ?? []).filter(s => s.is_completed === false).length;
      diagnostics.counted_sets += sets.length; completed += sets.length;
      const meta = metadata.get(String(exercise.exercise_id));
      if (!meta) {diagnostics.unmatched_exercises++; continue;}
      const primary = decodeIds(meta.Target_muscles_id), secondary = decodeIds(meta.Synergist_muscles_id);
      if (!primary.valid || !primary.ids.length) diagnostics.missing_primary_mappings++;
      if (!secondary.valid) diagnostics.missing_secondary_mappings++;
      if (!sets.length) continue;
      for (const [group, weight] of [[primary.ids, 1], [secondary.ids.filter(id => !primary.ids.includes(id)), secondaryWeight]] as const) {
        for (const id of group) {
          const direct = weight === 1 && primary.ids.includes(id);
          (direct ? primaryIds : secondaryIds).add(id);
          const row = load.get(id) ?? {primary: 0, secondary: 0, last: 0, lastId: null, sessions: new Set<string>(), weeks: new Map<string, {direct: number; indirect: number}>(), rir: new Array<number>()};
          if (direct) row.primary += sets.length; else row.secondary += sets.length * weight;
          if (timestamp >= row.last) {row.last = timestamp; row.lastId = workout.id ?? null;}
          row.sessions.add(String(workout.id ?? timestamp));
          const week = weekOf(timestamp), weekly = row.weeks.get(week) ?? {direct: 0, indirect: 0};
          if (direct) weekly.direct += sets.length; else weekly.indirect += sets.length * weight;
          row.weeks.set(week, weekly);
          row.rir.push(...sets.map(s => numeric(s.rir)).filter((n): n is number => n !== null));
          load.set(id, row);
        }
      }
    }
    perWorkout.push({id: workout.id ?? null, timestamp: new Date(timestamp).toISOString(), primary_muscles: [...primaryIds],
      secondary_muscles: [...secondaryIds].filter(id => !primaryIds.has(id)), completed_sets: completed});
  }
  const muscle_load = [...load].map(([id, row]) => ({muscle_id: id, muscle_name: MUSCLES[id] ?? null,
    direct_sets: row.primary, secondary_set_equivalents: row.secondary, last_workout: new Date(row.last).toISOString(), last_workout_id: row.lastId,
    hours_since_last_workout: Math.round((now.getTime() - row.last) / 360_000) / 10,
    recorded_sessions: row.sessions.size, sessions_per_week: row.sessions.size * 7 / days,
    mean_recorded_rir: row.rir.length ? row.rir.reduce((a, b) => a + b, 0) / row.rir.length : null,
    rir_observations: row.rir.length, weekly_sets: [...row.weeks].map(([week, counts]) => ({week_start_utc: week, ...counts}))
  })).sort((a, b) => b.direct_sets + b.secondary_set_equivalents - a.direct_sets - a.secondary_set_equivalents);
  return {muscle_load, workouts: perWorkout, diagnostics, secondary_weight: secondaryWeight,
    no_recorded_stimulus_in_window: Object.keys(MUSCLES).filter(id => !load.has(id)).map(id => ({id, name: MUSCLES[id]})),
    interpretation: "Direct sets are exercise associations, not measured stimulus. Secondary set weighting is a heuristic. Missing logs or metadata can conceal exposure. Time elapsed does not establish recovery or readiness; Lyfta recovery percentages and physiological recovery are unavailable."};
}
function periodStats(workouts: PerformedWorkout[], start: number, end: number, inclusiveEnd: boolean) {
  const selected = workouts.filter(w => {const t = timeOf(w.workout_perform_date); return t >= start && (inclusiveEnd ? t <= end : t < end);});
  const byExercise = new Map<string, {exercise_id: string; unit: string; points: {date: string; best_weight: number | null; estimated_1rm: number | null}[]; completed_sets: number; reps: number; volume: number; pr_markers: number}>();
  const volume: Record<string, number> = {kg: 0, lb: 0};
  const weeks: Record<string, number> = {};
  let completed = 0, reps = 0, missingVolume = 0;
  for (const w of selected) {
    const t = timeOf(w.workout_perform_date), week = weekOf(t); weeks[week] = (weeks[week] ?? 0) + 1;
    for (const ex of w.exercises ?? []) {
      const unit = w.weight_unit ?? "unknown", id = String(ex.exercise_id ?? "unknown");
      const row = byExercise.get(id + ":" + unit) ?? {exercise_id: id, unit, points: [], completed_sets: 0, reps: 0, volume: 0, pr_markers: 0};
      const sets = (ex.sets ?? []).filter(s => s.is_completed === true);
      if (!sets.length) continue;
      let best: number | null = null, rm: number | null = null;
      for (const s of sets) {
        completed++; row.completed_sets++;
        const r = numeric(s.reps), weight = numeric(s.weight);
        if (r !== null && Number.isInteger(r)) {reps += r; row.reps += r;}
        if (r !== null && Number.isInteger(r) && weight !== null && ex.exercise_type === "weight_reps" && unit !== "unknown") {
          const v = weight * r; volume[unit] = (volume[unit] ?? 0) + v; row.volume += v;
          best = Math.max(best ?? 0, weight);
          if (r >= 1 && r <= 10 && weight > 0) rm = Math.max(rm ?? 0, weight * (1 + r / 30));
        } else missingVolume++;
        if ([s.record_type, s.record_level, s.record_value].some(v => v != null && v !== "" && v !== "0" && v !== 0)) row.pr_markers++;
      }
      row.points.push({date: new Date(t).toISOString(), best_weight: best, estimated_1rm: rm}); byExercise.set(id + ":" + unit, row);
    }
  }
  const exercises = [...byExercise.values()].map(row => {
    row.points.sort((a, b) => a.date.localeCompare(b.date));
    const points = row.points.filter(p => p.best_weight !== null);
    const first = points[0], last = points.at(-1);
    const recent = points.slice(-3);
    return {...row, weight_change: first && last && first !== last ? last.best_weight! - first.best_weight! : null,
      possible_plateau_observation: recent.length >= 3 && recent.every(p => p.best_weight === recent[0]?.best_weight)
        ? "Same best recorded weight in last three exposures; programming intent and effort are unknown" : null};
  });
  return {recorded_completed_sessions: selected.length, completed_sets: completed, completed_repetitions: reps,
    volume_by_weight_unit: volume, sets_excluded_from_volume: missingVolume, weekly_sessions_utc: weeks, exercises};
}
export function analyzeTraining(workouts: PerformedWorkout[], catalog: PerformedExercise[], days = 14, now = new Date(), secondaryWeight = 0.5, expectedWeeklySessions?: number) {
  const end = now.getTime(), start = end - days * DAY;
  const current = periodStats(workouts, start, end, true), previous = periodStats(workouts, start - days * DAY, start, false);
  const muscles = analyzeMuscles(workouts, catalog, days, now, secondaryWeight);
  // Previous interval excludes the shared boundary exactly.
  const previousWorkouts = workouts.filter(w => timeOf(w.workout_perform_date) < start);
  const previousMuscles = analyzeMuscles(previousWorkouts, catalog, days, new Date(start), secondaryWeight);
  const idsInEither = new Set([...muscles.muscle_load, ...previousMuscles.muscle_load].map(m => m.muscle_id));
  const muscle_changes = [...idsInEither].map(id => ({muscle_id: id,
    direct_set_change: (muscles.muscle_load.find(m => m.muscle_id === id)?.direct_sets ?? 0) - (previousMuscles.muscle_load.find(m => m.muscle_id === id)?.direct_sets ?? 0),
    secondary_equivalent_change: (muscles.muscle_load.find(m => m.muscle_id === id)?.secondary_set_equivalents ?? 0) - (previousMuscles.muscle_load.find(m => m.muscle_id === id)?.secondary_set_equivalents ?? 0)}));
  const balance = [["4", "44"], ["27", "17"], ["24", "20"]].map(([a, b]) => ({muscle_a: a, muscle_b: b,
    direct_sets_a: muscles.muscle_load.find(m => m.muscle_id === a)?.direct_sets ?? 0,
    direct_sets_b: muscles.muscle_load.find(m => m.muscle_id === b)?.direct_sets ?? 0}));
  const exercise_period_changes = current.exercises.map(ex => {
    const prior = previous.exercises.find(p => p.exercise_id === ex.exercise_id && p.unit === ex.unit);
    const best = (points: typeof ex.points) => {
      const weights = points.map(p => p.best_weight).filter((v): v is number => v !== null);
      return weights.length ? Math.max(...weights) : null;
    };
    const currentBest = best(ex.points), previousBest = prior ? best(prior.points) : null;
    return {exercise_id: ex.exercise_id, unit: ex.unit, current_best_weight: currentBest, previous_best_weight: previousBest,
      best_weight_change: currentBest !== null && previousBest !== null ? currentBest - previousBest : null,
      completed_set_change: ex.completed_sets - (prior?.completed_sets ?? 0), record_marker_change: ex.pr_markers - (prior?.pr_markers ?? 0)};
  });
  return {window: {days, start_utc: new Date(start).toISOString(), end_utc: now.toISOString(), timezone: "UTC; unzoned Lyfta dates assumed UTC"},
    current, previous, session_change: current.recorded_completed_sessions - previous.recorded_completed_sessions,
    completed_set_change: current.completed_sets - previous.completed_sets,
    volume_change_by_weight_unit: {kg: (current.volume_by_weight_unit.kg ?? 0) - (previous.volume_by_weight_unit.kg ?? 0),
      lb: (current.volume_by_weight_unit.lb ?? 0) - (previous.volume_by_weight_unit.lb ?? 0)}, exercise_period_changes,
    weekly_frequency: current.recorded_completed_sessions * 7 / days,
    session_target_shortfall: expectedWeeklySessions === undefined ? null : Math.max(0, Math.ceil(expectedWeeklySessions * days / 7) - current.recorded_completed_sessions),
    missed_scheduled_sessions: null, muscles, muscle_changes, related_muscle_comparisons: balance,
    caveats: ["Incomplete coverage invalidates absence and period conclusions.", "Set distributions are descriptive; no universal ideal ratio or diagnosis is inferred.",
      "Epley estimates use external weight and 1-10 reps on weight_reps sets only; bodyweight, assistance and effort are unknown.",
      "PR markers are preserved evidence, not proof of all-time records. Progress endpoint exposes Lyfta best-set estimates.",
      "Weekly buckets start Monday UTC and edge weeks may be partial. Session shortfall compares a supplied target, not scheduled attendance."]};
}
