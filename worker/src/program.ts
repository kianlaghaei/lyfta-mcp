import type {WorkoutTemplate} from "./schema.js";
import {LyftaClient, LyftaApiError} from "./lyfta-client.js";
import {collectExercises} from "./history.js";
import type {CatalogExercise} from "./contracts.js";
import {ValidationError} from "./errors.js";

/** Verify official catalog ID, exact name and image. Lyfta occasionally omits
 * exercise_type; only explicitly supported types can then be user-supplied,
 * and every such fallback is reported as unverified. */
const supportedTypes = new Set(["weight_reps", "duration", "distance_duration", "full_bodyweight",
  "bodyweight_assisted", "db_2_simultaneous", "db_1_both_sides", "db_1_alt_sides", "db_1_alt_legs",
  "db_2_alt_sides", "db_2_alt_legs"]);
export async function validateIdentities(client: LyftaClient, workouts: WorkoutTemplate[]) {
  const performed = await collectExercises(client, 3);
  const catalog = new Map(performed.records.map(ex => [String(ex.id), ex]));
  const exercises = new Map(workouts.flatMap(w => w.exercises).map(ex => [ex.exercise_id, ex]));
  if (exercises.size > 30) throw new ValidationError("Use at most 30 distinct exercises per preview");
  const unknownTypes = new Set<number>();
  for (const ex of exercises.values()) {
    let match: CatalogExercise | undefined = catalog.get(String(ex.exercise_id));
    if (!match || match.exercise_type == null) {
      let offset = 0;
      for (let page = 0; page < 2; page++) {
        const found = (await client.searchExercises(ex.excercise_name, 50, offset)).data;
        const candidate = found.results.find(item => String(item.id) === String(ex.exercise_id));
        if (candidate && (candidate.exercise_type != null || !match)) match = candidate;
        if (match?.exercise_type != null || !found.pagination.hasMore || !found.results.length) break;
        offset += found.results.length;
      }
    }
    if (!match) throw new ValidationError("Exercise " + ex.exercise_id + " identity not found in Lyfta catalog coverage");
    if (match.exercise_type == null) {
      if (!supportedTypes.has(ex.exercise_type)) throw new ValidationError("Exercise " + ex.exercise_id + " has no catalog type; unsupported fallback type");
      unknownTypes.add(ex.exercise_id);
    }
    catalog.set(String(ex.exercise_id), match);
  }
  // Check every occurrence, including duplicate IDs with inconsistent fields.
  for (const ex of workouts.flatMap(w => w.exercises)) {
    const match = catalog.get(String(ex.exercise_id));
    if (!match || match.name !== ex.excercise_name ||
      (match.image_name ?? "") !== ex.exercise_image ||
      (match.exercise_type == null ? !supportedTypes.has(ex.exercise_type) : match.exercise_type !== ex.exercise_type))
      throw new ValidationError("Exercise " + ex.exercise_id + " name, type or image differs from Lyfta catalog");
  }
  return {verified_exercises: exercises.size, unverified_exercise_type_ids: [...unknownTypes],
    performed_catalog: performed.diagnostics,
    workouts: workouts.map(w => ({title: w.title, exercises: w.exercises.length, sets: w.exercises.reduce((n, e) => n + e.sets.length, 0),
      supersets: [...new Set(w.exercises.map(e => e.exercise_superset_id).filter(id => id && id > 0))]})),
    warnings: [...(unknownTypes.size ? ["Some exercise types are missing from Lyfta's catalog; their IDs, names and images were verified, but selected types remain unverified. Review them in the app after creation."] : []),
      "Weights use the owner's Lyfta preferences; the template API has no documented weight-unit override.",
      "Review exercise order, equipment, volume, rep ranges, RIR and rest against the user's requirements before confirming."]};
}
const enc = new TextEncoder();
function canonical(value: unknown): string {
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  if (typeof value === "object" && value !== null) return "{" + Object.entries(value).filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => JSON.stringify(k) + ":" + canonical(v)).join(",") + "}";
  return JSON.stringify(value) ?? "null";
}
async function key(secret: string) {
  if (secret.length < 32) throw new Error("Preview signing credential is not configured");
  return crypto.subtle.importKey("raw", enc.encode(secret), {name: "HMAC", hash: "SHA-256"}, false, ["sign", "verify"]);
}
export async function signPreview(secret: string, payload: unknown, now = Date.now()) {
  const expires = now + 600_000;
  const signature = new Uint8Array(await crypto.subtle.sign("HMAC", await key(secret), enc.encode(expires + ":" + canonical(payload))));
  return {preview_token: expires + "." + Array.from(signature, b => b.toString(16).padStart(2, "0")).join(""), expires_at: new Date(expires).toISOString()};
}
export async function verifyPreview(secret: string, payload: unknown, token: string, now = Date.now()) {
  const [expiry, mac] = token.split(".");
  if (!expiry || !mac || !/^\d+$/.test(expiry) || !/^[0-9a-f]{64}$/.test(mac) || Number(expiry) < now || Number(expiry) > now + 600_000)
    throw new ValidationError("Preview expired or invalid; preview again");
  const bytes = Uint8Array.from(mac.match(/../g) ?? [], s => parseInt(s, 16));
  if (!await crypto.subtle.verify("HMAC", await key(secret), bytes, enc.encode(expiry + ":" + canonical(payload))))
    throw new ValidationError("Payload changed after preview; preview again");
}
export function failure(error: unknown) {
  return error instanceof LyftaApiError ? {error: error.message, status: error.statusCode,
    retry_after: error.retryAfter ?? null, outcome_unknown: error.outcomeUnknown,
    ...(error.outcomeUnknown ? {action: "Inspect the saved library before any repeated write"} : {})}
    : {error: error instanceof ValidationError ? error.message : "Operation could not complete", outcome_unknown: false};
}
