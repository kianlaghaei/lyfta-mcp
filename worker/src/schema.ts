import { z } from "zod";

// Lyfta API stores set measures as strings. Do not coerce to numbers on writes.
export const setSchema = z.object({
  set_type_id: z.number().int().nonnegative().optional(),
  reps: z.string().optional(),
  from_reps: z.string().optional(),
  to_reps: z.string().optional(),
  weight: z.string().optional(),
  rir: z.string().optional(),
  duration: z.string().optional(),
  distance: z.string().optional()
}).strict();

export const exerciseSchema = z.object({
  exercise_id: z.number().int().positive(),
  excercise_name: z.string().min(1), // Intentional legacy Lyfta spelling.
  exercise_type: z.string().min(1),
  exercise_image: z.string().min(1),
  exercise_rest_time: z.number().int().nonnegative().optional(),
  exercise_superset_id: z.number().int().nonnegative().optional(),
  exercise_note: z.string().optional(),
  is_rep_range_active: z.boolean().optional(),
  sets: z.array(setSchema).max(30).default([])
}).strict();

export const workoutSchema = z.object({
  title: z.string().min(1).max(120),
  description: z.string().max(1000).optional(),
  note: z.string().max(2000).optional(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  picture: z.string().optional(),
  exercises: z.array(exerciseSchema).min(1).max(30)
}).strict();

export type WorkoutTemplate = z.infer<typeof workoutSchema>;
