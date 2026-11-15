import type {CatalogExercise, LoggedWorkout} from "../src/contracts.js";
import type {WorkoutTemplate} from "../src/schema.js";
export const secret = "synthetic-mcp-token-for-tests-only-123456789";
export const exercise: CatalogExercise = {id: "31", name: "Rear Lunge", image_name: "https://apilyfta.com/31.png",
  exercise_type: "weight_reps", equipment_id: '["1"]', body_part_id: '["19","1"]',
  Target_muscles_id: '["13","27"]', Synergist_muscles_id: '["3","32"]'};
export const workout: WorkoutTemplate = {title: "Legs", exercises: [{exercise_id: 31, excercise_name: "Rear Lunge",
  exercise_type: "weight_reps", exercise_image: "https://apilyfta.com/31.png", exercise_rest_time: 90,
  sets: [{set_type_id: 0, weight: "60", reps: "10", rir: "2"}]}]};
export const program = {collection: {title: "Synthetic program"}, workouts: [workout]};
export function logged(id: number, timestamp: string, unit: "kg" | "lb" | null = "kg"): LoggedWorkout {
  return {id, workout_perform_date: timestamp, weight_unit: unit, exercises: [{exercise_id: 31, exercise_type: "weight_reps",
    excercise_name: "Rear Lunge", sets: [{is_completed: true, reps: "10", weight: "60", rir: "2"},
      {is_completed: false, reps: "10", weight: "100"}, {reps: "10", weight: "200"}]}]};
}
export function apiResponse(url: string, init?: RequestInit): Response {
  const path = new URL(url).pathname;
  if (path === "/api/v1/exercises") return Response.json({status: true, exercises: [exercise], total_pages: 1, current_page: 1});
  if (path === "/api/v1/exercises/library") return Response.json({status: true, data: {results: [exercise], pagination: {limit: 50, offset: Number(new URL(url).searchParams.get("offset") ?? 0), total: 1, hasMore: false}}});
  if (path.startsWith("/api/v1/collections/") && init?.method !== "POST") return Response.json({status: true, data: {id: 42, title: "Synthetic"}});
  if (init?.method === "POST") return Response.json({status: true, data: {id: path.endsWith("collections") ? 42 : 77}});
  return Response.json({status: true, workouts: [], total_pages: 0});
}
