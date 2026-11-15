import { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { LyftaClient, LyftaApiError } from "./lyfta-client.js";
import { analyzeMuscles, type PerformedExercise, type PerformedWorkout } from "./analysis.js";
import { workoutSchema } from "./schema.js";

type ToolResult = { content: {type: "text"; text: string}[]; isError?: boolean };

function result(data: unknown): ToolResult {
  return {content: [{type: "text", text: JSON.stringify(data, null, 2)}]};
}
async function safe(fn: () => Promise<unknown>): Promise<ToolResult> {
  try { return result(await fn()); }
  catch (error) {
    const reason = error instanceof LyftaApiError ?
      {error: error.message, status: error.statusCode, retry_after: error.retryAfter ?? null} :
      {error: error instanceof Error ? error.message : "Unknown error"};
    return {content: [{type: "text", text: JSON.stringify(reason)}], isError: true};
  }
}

export function createServer(client: LyftaClient) {
  const server = new McpServer({name: "lyfta-personal", version: "0.1.0"});

  server.registerTool("search_exercises", {
    description: "Search the Lyfta exercise library for real exercise IDs, names, images and muscle mappings. Use before constructing workout templates.",
    inputSchema: z.object({
      search: z.string().max(100).default(""),
      limit: z.number().int().min(1).max(50).default(20),
      offset: z.number().int().nonnegative().default(0)
    })
  }, ({search, limit, offset}) => safe(() => client.searchExercises(search, limit, offset)));

  server.registerTool("list_performed_exercises", {
    description: "List exercises recorded by this account, including target and synergist muscle ID fields.",
    inputSchema: z.object({})
  }, () => safe(() => client.performedExercises()));

  server.registerTool("get_workout_history", {
    description: "Retrieve logged workouts. Summary mode is compact; details include completed sets and weights.",
    inputSchema: z.object({
      page: z.number().int().min(1).default(1),
      limit: z.number().int().min(1).max(50).default(15),
      detailed: z.boolean().default(false)
    })
  }, ({page, limit, detailed}) => safe(() => detailed ? client.workouts(page, limit) : client.summaries(page, limit)));

  server.registerTool("get_exercise_progress", {
    description: "Retrieve Lyfta exercise progress records (best weight, reps, volume and estimated 1RM).",
    inputSchema: z.object({
      exercise_id: z.string().min(1),
      duration_days: z.number().int().min(1).max(730).default(90)
    })
  }, ({exercise_id, duration_days}) => safe(() => client.progress(exercise_id, duration_days)));

  server.registerTool("preview_workout_template", {
    description: "Validate and preview a workout template WITHOUT writing to Lyfta. All exercise identity fields must be copied from a real Lyfta catalog record.",
    inputSchema: z.object({workout: workoutSchema})
  }, ({workout}) => result({valid: true, workout, note: "Schema-validated only. Catalog identity must still be checked against search_exercises results before publish."}));

  server.registerTool("create_program", {
    description: "Create a real collection/program in Lyfta. WRITE operation: always preview with user and require explicit confirmation.",
    inputSchema: z.object({
      title: z.string().min(1).max(120),
      description: z.string().max(1000).optional(),
      goal: z.string().max(300).optional(),
      confirm: z.literal(true)
    })
  }, ({title, description, goal}) => safe(() => client.createCollection({title, description, goal})));

  server.registerTool("create_workout_template", {
    description: "Publish a real workout template into an existing Lyfta collection. WRITE: explicitly confirm; never auto-retry (can create duplicates).",
    inputSchema: z.object({
      collection_id: z.number().int().positive(),
      workout: workoutSchema,
      confirm: z.literal(true)
    })
  }, ({collection_id, workout}) => safe(() => client.createTemplate(collection_id, workout)));

  server.registerTool("analyze_muscle_load", {
    description: "Estimate which muscles received the most logged sets during a time window. Secondary exercise involvement weighted 0.5 heuristically. NOT an in-app Lyfta recovery percentage.",
    inputSchema: z.object({
      days: z.number().int().min(1).max(90).default(14),
      page_limit: z.number().int().min(1).max(100).default(60)
    })
  }, ({days, page_limit}) => safe(async () => {
    const [workoutsResponse, exercisesResponse] = await Promise.all([
      client.workouts(1, page_limit), client.performedExercises()
    ]) as [Record<string, unknown>, Record<string, unknown>];
    const workouts = Array.isArray(workoutsResponse.workouts) ? workoutsResponse.workouts as PerformedWorkout[] : [];
    const exercises = Array.isArray(exercisesResponse.exercises) ? exercisesResponse.exercises as PerformedExercise[] : [];
    return {...analyzeMuscles(workouts, exercises, days),
      pagination_notice: "First page only; check total_pages and fetch further pages when needed.",
      total_pages: workoutsResponse.total_pages ?? null};
  }));

  server.registerTool("estimate_recovery", {
    description: "Return time since last logged sets per muscle, not a measured recovery score. Interpret with soreness, sleep, fatigue and other user feedback.",
    inputSchema: z.object({days: z.number().int().min(1).max(90).default(14)})
  }, ({days}) => safe(async () => {
    const [w, e] = await Promise.all([client.workouts(1, 100), client.performedExercises()]) as [Record<string, unknown>, Record<string, unknown>];
    const report = analyzeMuscles(
      Array.isArray(w.workouts) ? w.workouts as PerformedWorkout[] : [],
      Array.isArray(e.exercises) ? e.exercises as PerformedExercise[] : [], days
    );
    return {last_trained_by_muscle: report.muscle_load.map(({muscle_id, muscle_name, last_workout, hours_since_last_workout, timing_category}) =>
      ({muscle_id, muscle_name, last_workout, hours_since_last_workout, timing_category})),
      diagnostics: report.diagnostics,
      warning: report.interpretation,
      pagination_notice: "First 100 workouts only; this is a temporal proxy, not an actual recovery estimate."};
  }));
  return server;
}
