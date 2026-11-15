import { z } from "zod";
export const idSchema = z.union([z.string().regex(/^\d+$/), z.number().int().nonnegative()]);
const scalar = z.union([z.string(), z.number().finite()]).nullish();
const idList = z.union([z.string(), z.array(idSchema)]).nullish();
export const catalogSchema = z.object({id: idSchema, name: z.string().nullish(), image_name: z.string().nullish(),
  exercise_type: z.string().nullish(), equipment_id: idList, body_part_id: idList,
  Target_muscles_id: idList, Synergist_muscles_id: idList});
export const loggedSetSchema = z.object({id: z.union([z.string(), z.number().int().nonnegative()]).nullish(), is_completed: z.boolean().nullish(),
  set_type_id: scalar, weight: scalar, reps: scalar, rir: scalar, duration: scalar, distance: scalar,
  record_type: z.string().nullish(), record_level: z.string().nullish(), record_value: scalar});
export const loggedExerciseSchema = z.object({exercise_id: idSchema.nullish(), excercise_name: z.string().nullish(),
  exercise_type: z.string().nullish(), exercise_image: z.string().nullish(), exercise_rest_time: scalar,
  sets: z.array(loggedSetSchema).nullish()});
export const loggedWorkoutSchema = z.object({id: idSchema, title: z.string().nullish(), description: z.string().nullish(),
  weight_unit: z.enum(["kg", "lb"]).nullish(), workout_duration: scalar,
  workout_perform_date: z.string().nullish(), total_volume: scalar, exercises: z.array(loggedExerciseSchema).nullish()});
export const pageFields = {count: z.number().int().nonnegative().optional(), total_records: z.number().int().nonnegative().optional(),
  total_pages: z.number().int().nonnegative().optional(), current_page: z.coerce.number().int().positive().optional(), limit: z.number().int().positive().optional()};
export const workoutPageSchema = z.object({...pageFields, workouts: z.array(loggedWorkoutSchema)});
/** Lyfta's performed catalog may contain rows without numeric identities.
 * Reject those rows rather than inventing IDs, and expose the loss to callers. */
export const exercisePageSchema = z.preprocess((value: unknown) => {
  if (!value || typeof value !== "object") return value;
  const input = value as {exercises?: unknown[]};
  if (!Array.isArray(input.exercises)) return value;
  const exercises = input.exercises.filter(row => catalogSchema.safeParse(row).success);
  return {...input, exercises, skipped_invalid_records: input.exercises.length - exercises.length};
}, z.object({...pageFields, exercises: z.array(catalogSchema),
  skipped_invalid_records: z.number().int().nonnegative().optional()}));
export const searchPageSchema = z.object({data: z.object({results: z.array(catalogSchema), pagination: z.object({
  limit: z.number().int().positive(), offset: z.number().int().nonnegative(), total: z.number().int().nonnegative(), hasMore: z.boolean()})})});
export const progressSchema = z.object({weight_unit: z.enum(["kg", "lb"]).nullish(), data: z.array(z.object({
  date: z.string(), best_weight: scalar, best_reps: scalar, best_volume: scalar, estimated_rm: scalar}))});
export const savedSchema = z.object({id: idSchema}).passthrough();
export const createdSchema = z.object({data: savedSchema});
export type CatalogExercise = z.infer<typeof catalogSchema>;
export type LoggedWorkout = z.infer<typeof loggedWorkoutSchema>;
export type LoggedSet = z.infer<typeof loggedSetSchema>;
export function decodeIds(value: unknown): {ids: string[]; valid: boolean} {
  let data: unknown = value;
  if (typeof data === "string") {try {data = JSON.parse(data);} catch {return {ids: [], valid: false};}}
  if (!Array.isArray(data) || !data.every(id => typeof id === "number" && Number.isInteger(id) && id >= 0
    || typeof id === "string" && /^\d+$/.test(id))) return {ids: [], valid: false};
  return {ids: [...new Set(data.map(String))], valid: true};
}
