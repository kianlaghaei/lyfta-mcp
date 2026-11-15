import {z} from "zod";
const measure = z.string().max(24).regex(/^(?:\d+(?:\.\d+)?)?$/);
const reps = z.string().max(5).regex(/^\d*$/);
export const setSchema = z.object({set_type_id: z.number().int().nonnegative().optional(),
  reps: reps.optional(), from_reps: reps.optional(), to_reps: reps.optional(), weight: measure.optional(),
  rir: measure.optional(), duration: measure.optional(), distance: measure.optional()}).strict()
  .refine(s => !s.from_reps || !s.to_reps || Number(s.from_reps) <= Number(s.to_reps), "Repetition range is reversed");
export const exerciseSchema = z.object({exercise_id: z.number().int().positive(),
  excercise_name: z.string().min(1).max(250), exercise_type: z.string().max(100), exercise_image: z.string().max(2000),
  exercise_rest_time: z.number().int().nonnegative().max(86400).optional(),
  exercise_superset_id: z.number().int().nonnegative().optional(), exercise_note: z.string().max(2000).optional(),
  is_rep_range_active: z.boolean().optional(), sets: z.array(setSchema).min(1).max(30)}).strict()
  .refine(e => !e.is_rep_range_active || e.sets.every(s => s.from_reps && s.to_reps), "Range mode needs lower and upper reps for every set");
const picture = z.string().max(100_000).refine(s => s === "" || /^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(s)
  || /^https:\/\/(?:[a-z0-9-]+\.)*(?:apilyfta\.com|cdnlyfta\.com)\//i.test(s), "Use base64 image data URI or a Lyfta CDN URL");
export const workoutSchema = z.object({title: z.string().trim().min(1).max(120), description: z.string().max(1000).optional(),
  note: z.string().max(2000).optional(), color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(), picture: picture.optional(),
  exercises: z.array(exerciseSchema).min(1).max(30)}).strict();
export const collectionSchema = z.object({title: z.string().trim().min(1).max(120), description: z.string().max(1000).optional(),
  goal: z.string().max(300).optional(), image: z.string().min(4).max(100_000).regex(/^[A-Za-z0-9+/]+={0,2}$/).optional()}).strict();
export const programSchema = z.object({collection: collectionSchema, workouts: z.array(workoutSchema).min(1).max(8)}).strict();
export type WorkoutTemplate = z.infer<typeof workoutSchema>;
export type Collection = z.infer<typeof collectionSchema>;
