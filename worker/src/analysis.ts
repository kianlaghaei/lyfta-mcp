/** Conservative, explainable workload analysis. NOT Lyfta's proprietary recovery score. */
export interface PerformedExercise {
  id?: string | number;
  name?: string;
  Target_muscles_id?: string | (string | number)[];
  Synergist_muscles_id?: string | (string | number)[];
}
export interface WorkoutSet {
  is_completed?: boolean;
  set_type_id?: string | number;
  weight?: string | number;
  reps?: string | number;
}
export interface WorkoutExercise {
  exercise_id?: string | number;
  sets?: WorkoutSet[];
}
export interface PerformedWorkout {
  workout_perform_date?: string;
  exercises?: WorkoutExercise[];
}
export interface MuscleRow {
  muscle_id: string;
  muscle_name: string;
  direct_sets: number;
  secondary_set_equivalents: number;
  last_workout: string;
  hours_since_last_workout: number;
  timing_category: "last_24h" | "24_to_48h" | "over_48h";
}

export const MUSCLES: Record<string, string> = {
  "2":"Adductor Longus","3":"Adductor Magnus","4":"Biceps Brachii","5":"Brachialis",
  "6":"Brachioradialis","7":"Deep Hip External Rotators","8":"Anterior Deltoid",
  "9":"Lateral Deltoid","10":"Posterior Deltoid","11":"Erector Spinae",
  "12":"Gastrocnemius","13":"Gluteus Maximus","14":"Gluteus Medius",
  "15":"Gluteus Minimus","16":"Gracilis","17":"Hamstrings","18":"Iliopsoas",
  "19":"Infraspinatus","20":"Latissimus Dorsi","21":"Levator Scapulae",
  "22":"Obliques","23":"Pectineus","24":"Pectoralis Major Clavicular Head",
  "25":"Pectoralis Major Sternal Head","26":"Popliteus","27":"Quadriceps",
  "28":"Rectus Abdominis","29":"Sartorius","30":"Serratus Ante",
  "31":"Serratus Anterior","32":"Soleus","33":"Splenius",
  "34":"Sternocleidomastoid","35":"Subscapularis","36":"Tensor Fasciae Latae",
  "37":"Teres Major","38":"Teres Minor","39":"Tibialis Anterior",
  "40":"Transverse Abdominis","41":"Trapezius Lower Fibers",
  "42":"Trapezius Middle Fibers","43":"Trapezius Upper Fibers",
  "44":"Triceps Brachii","45":"Wrist Extensors","46":"Wrist Flexors"
};

export function ids(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String);
  if (typeof value !== "string") return [];
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

function timeOf(value: unknown): number {
  if (typeof value !== "string") return NaN;
  const raw = value.trim().replace(" ", "T");
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return Date.parse(raw + "T00:00:00Z");
  return Date.parse(/(?:Z|[+-]\d{2}:\d{2})$/i.test(raw) ? raw : raw + "Z");
}

export function analyzeMuscles(
  workouts: PerformedWorkout[],
  performedExercises: PerformedExercise[],
  days = 14,
  now = new Date()
): { muscle_load: MuscleRow[]; diagnostics: Record<string, unknown>; interpretation: string } {
  const metadata = new Map(performedExercises.map(ex => [String(ex.id ?? ""), ex]));
  const entries = new Map<string, {primary: number; secondary: number; last: number}>();
  const lowerBound = now.getTime() - days * 86_400_000;
  let analyzedWorkouts = 0, unmatchedExercises = 0, countedSets = 0;
  for (const workout of workouts) {
    const timestamp = timeOf(workout.workout_perform_date);
    if (!Number.isFinite(timestamp) || timestamp > now.getTime() || timestamp < lowerBound) continue;
    analyzedWorkouts++;
    for (const exercise of workout.exercises ?? []) {
      const meta = metadata.get(String(exercise.exercise_id ?? ""));
      if (!meta) { unmatchedExercises++; continue; }
      const sets = (exercise.sets ?? []).filter(s => s.is_completed !== false).length;
      if (sets === 0) continue;
      countedSets += sets;
      const primary = new Set(ids(meta.Target_muscles_id));
      const secondary = new Set(ids(meta.Synergist_muscles_id));
      for (const id of primary) {
        const row = entries.get(id) ?? {primary: 0, secondary: 0, last: 0};
        row.primary += sets;
        row.last = Math.max(row.last, timestamp);
        entries.set(id, row);
      }
      for (const id of secondary) {
        if (primary.has(id)) continue;
        const row = entries.get(id) ?? {primary: 0, secondary: 0, last: 0};
        row.secondary += sets * 0.5; // Analytical weight, not an equivalent biological stimulus.
        row.last = Math.max(row.last, timestamp);
        entries.set(id, row);
      }
    }
  }
  const muscle_load = [...entries.entries()].map(([id, row]) => {
    const hours = (now.getTime() - row.last) / 3_600_000;
    return {
      muscle_id: id,
      muscle_name: MUSCLES[id] ?? "Unknown muscle ID " + id,
      direct_sets: row.primary,
      secondary_set_equivalents: row.secondary,
      last_workout: new Date(row.last).toISOString(),
      hours_since_last_workout: Math.round(hours * 10) / 10,
      timing_category: hours < 24 ? "last_24h" as const : hours < 48 ? "24_to_48h" as const : "over_48h" as const
    };
  }).sort((a,b) => (b.direct_sets + b.secondary_set_equivalents) - (a.direct_sets + a.secondary_set_equivalents));
  return {
    muscle_load,
    diagnostics: {window_days: days, analyzed_workouts: analyzedWorkouts, counted_sets: countedSets,
      unmatched_exercises: unmatchedExercises, known_exercise_catalog_size: performedExercises.length},
    interpretation: "These are counted exercise sets and heuristically weighted secondary involvement. Timing is not physiological recovery. Lyfta's in-app recovery score is not exposed by the public API. Fatigue, pain, sleep, RPE, soreness and effort must be assessed separately."
  };
}
