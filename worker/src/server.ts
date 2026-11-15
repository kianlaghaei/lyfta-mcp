import {McpServer} from "@modelcontextprotocol/server";
import {z} from "zod";
import {LyftaClient, parseResponse} from "./lyfta-client.js";
import {analyzeTraining, timeOf} from "./analysis.js";
import {normalizeExercise, searchCatalog} from "./catalog.js";
import {collectExercises, collectPages, collectWorkouts} from "./history.js";
import {pageFields, savedSchema} from "./contracts.js";
import {programSchema, workoutSchema} from "./schema.js";
import {failure, signPreview, validateIdentities, verifyPreview} from "./program.js";

const outputSchema = z.object({data: z.record(z.string(), z.unknown())});
const pages = z.number().int().min(1).max(10).default(5);
const positive = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const token = z.string().min(1).max(100);
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(s => Number.isFinite(timeOf(s)), "Invalid UTC date");
function result(data: Record<string, unknown>) {
  const structuredContent = {data};
  const text = JSON.stringify(structuredContent);
  if (new TextEncoder().encode(text).length > 750_000)
    return {content: [{type: "text" as const, text: '{"error":"Result exceeds output byte budget; narrow the request"}'}], isError: true};
  return {content: [{type: "text" as const, text}], structuredContent, ...(data.write_status === "partial_or_unknown" ? {isError: true} : {})};
}
async function safe(fn: () => Promise<Record<string, unknown>>) {
  try {return result(await fn());}
  catch (error) {return {content: [{type: "text" as const, text: JSON.stringify(failure(error))}], isError: true};}
}
const analysisSchema = z.object({days: z.number().int().min(1).max(90).default(14), max_pages: pages,
  secondary_weight: z.number().min(0).max(1).default(0.5), expected_weekly_sessions: z.number().min(0).max(21).optional()}).strict();
async function training(client: LyftaClient, args: z.infer<typeof analysisSchema>) {
  const now = new Date(), from = new Date(now.getTime() - args.days * 2 * 86_400_000).toISOString().slice(0, 10);
  const workouts = await collectWorkouts(client, from, now.toISOString().slice(0, 10), args.max_pages);
  const exercises = await collectExercises(client, args.max_pages);
  // Enrich missing history mappings only through documented catalog search, under the shared request budget.
  const metadata = new Map(exercises.records.map(ex => [String(ex.id), ex]));
  let lookups = 0;
  const attempted = new Set<string>();
  for (const ex of workouts.records.flatMap(w => w.exercises ?? [])) {
    const id = String(ex.exercise_id);
    if (metadata.get(id)?.Target_muscles_id != null || attempted.has(id) || !ex.excercise_name || lookups >= 8) continue;
    attempted.add(id); lookups++;
    const found = (await client.searchExercises(ex.excercise_name, 50)).data.results.find(item => String(item.id) === id);
    if (found) metadata.set(id, found);
  }
  return {...analyzeTraining(workouts.records, [...metadata.values()], args.days, now, args.secondary_weight, args.expected_weekly_sessions),
    completeness: {workouts: workouts.diagnostics, exercise_metadata: exercises.diagnostics,
      catalog_fallback_lookups: lookups, absence_is_not_proof_of_no_training: true}};
}
/** Fresh server/client per HTTP request; no shared user data or persistent sessions. */
export function createServer(client: LyftaClient, previewSecret: string) {
  const server = new McpServer({name: "lyfta-personal", version: "0.2.0"});
  function register<S extends z.ZodType>(name: string, description: string, inputSchema: S,
    fn: (args: z.output<S>) => Promise<Record<string, unknown>>, write = false) {
    const schema: z.ZodType = inputSchema;
    server.registerTool(name, {description, inputSchema: schema, outputSchema,
      annotations: {readOnlyHint: !write, destructiveHint: false, idempotentHint: !write, openWorldHint: true}},
      args => safe(() => fn(inputSchema.parse(args))));
  }
  register("search_exercises", "Search official Lyfta catalog by text. Equipment/body-part/primary/secondary ID filters run locally over bounded pages. Returns catalog identity and missing-field diagnostics; incomplete scans do not prove absence.",
    z.object({search: z.string().max(100).default(""), limit: z.number().int().min(1).max(100).default(20),
      offset: z.number().int().nonnegative().default(0), max_pages: pages,
      equipment_id: z.string().regex(/^\d+$/).optional(), body_part_id: z.string().regex(/^\d+$/).optional(),
      primary_muscle_id: z.string().regex(/^\d+$/).optional(), secondary_muscle_id: z.string().regex(/^\d+$/).optional()}).strict(),
    args => searchCatalog(client, args.search, args.limit, args.offset, args.max_pages, args));
  register("list_performed_exercises", "Retrieve bounded, deduplicated performed-exercise catalog metadata and decoded muscle/equipment IDs. Read completeness before reasoning about missing exercises.",
    z.object({max_pages: pages}).strict(), async ({max_pages}) => {
      const data = await collectExercises(client, max_pages); return {exercises: data.records.map(normalizeExercise), diagnostics: data.diagnostics};
    });
  register("get_workout_history", "Read completed workout history, bounded and deduplicated. Detailed mode preserves completion markers, raw measures and units; only detailed mode supports inclusive UTC date filters.",
    z.object({page: positive.default(1), limit: z.number().int().min(1).max(100).default(30), max_pages: pages,
      detailed: z.boolean().default(true), from: date.optional(), to: date.optional()}).strict()
      .refine(a => !a.from || !a.to || a.from <= a.to, "from must precede to")
      .refine(a => a.detailed || !a.from && !a.to, "Date filtering requires detailed mode"), async args => {
        const data = await collectPages(async page => {
          const r = args.detailed ? await client.workouts(page, args.limit, args.from, args.to) : await client.summaries(page, args.limit);
          return {...r, items: r.workouts};
        }, args.page, args.max_pages);
        return {workouts: data.records, diagnostics: data.diagnostics};
      });
  register("get_exercise_progress", "Read Lyfta best-set progress and estimated RM for a performed exercise. Values retain the reported kg/lb unit; these are Lyfta estimates rather than measured maxima.",
    z.object({exercise_id: z.string().regex(/^[1-9]\d*$/), duration_days: z.number().int().min(1).max(730).default(90)}).strict(),
    ({exercise_id, duration_days}) => client.progress(exercise_id, duration_days));
  register("get_saved_library", "Read saved collections/templates (list or full record), profile, API-key owner ID, or upcoming schedule using documented personal endpoints. No coach access. One bounded page per call.",
    z.object({resource: z.enum(["collections", "collection", "templates", "template", "schedule", "profile", "me"]),
      id: positive.optional(), page: positive.default(1), limit: z.number().int().min(1).max(100).default(20),
      view: z.enum(["summary", "full"]).default("summary"), from: date.optional(), to: date.optional(),
      include_completed: z.boolean().default(false)}).strict()
      .refine(a => !["collection", "template"].includes(a.resource) || a.id !== undefined, "Record ID is required")
      .refine(a => !a.from || !a.to || a.from <= a.to, "from must precede to"), async a => {
        if (a.resource === "me") {
          return parseResponse(z.object({id: positive}), await client.request("GET", "/api/v1/me"));
        }
        const path = "/api/v1/" + (a.resource === "collection" ? "collections/" + a.id : a.resource === "template" ? "templates/" + a.id : a.resource);
        const query = a.resource === "collection" ? {view: a.view} : a.resource === "schedule"
          ? {page: a.page, limit: a.limit, from: a.from, to: a.to, include_completed: String(a.include_completed)} : ["collections", "templates"].includes(a.resource) ? {page: a.page, limit: a.limit} : undefined;
        const response = await client.request("GET", path, query);
        if (a.resource === "collections") return parseResponse(z.object({...pageFields, collections: z.array(savedSchema)}), response);
        if (a.resource === "templates") return parseResponse(z.object({...pageFields, templates: z.array(savedSchema)}), response);
        if (a.resource === "schedule") return parseResponse(z.object({...pageFields, workouts: z.array(z.record(z.string(), z.unknown()))}), response);
        return parseResponse(z.object({data: z.record(z.string(), z.unknown())}), response);
      });
  register("preview_program", "Validate complete program schema and every exercise identity against Lyfta before any write. Returns set counts and a signed 10-minute payload receipt. Show the preview and request explicit human confirmation before create_program.",
    programSchema, async payload => ({valid: true, preview: payload, validation: await validateIdentities(client, payload.workouts),
      ...await signPreview(previewSecret, {kind: "program", ...payload}),
      confirmation_required: true, replay_warning: "Receipt is reusable until expiry; it is not an idempotency key. Never repeat creation automatically."}));
  register("create_program", "WRITE: create collection then its templates, after preview_program and explicit user confirmation. Exact payload/receipt required. Stops at first failure and reports created IDs, uncertain outcomes and unattempted templates. Never retry automatically.",
    programSchema.extend({preview_token: token, confirm: z.literal(true)}).strict(), async ({preview_token, confirm: _confirm, ...payload}) => {
      await verifyPreview(previewSecret, {kind: "program", ...payload}, preview_token);
      await validateIdentities(client, payload.workouts);
      let collection;
      try {collection = await client.createCollection(payload.collection);}
      catch (error) {return {write_status: "partial_or_unknown", collection: null, templates: [], failure: failure(error),
        unattempted_templates: payload.workouts.map(w => w.title), action: "Inspect saved collections before deciding whether to create again"};}
      const id = positive.safeParse(Number(collection.id));
      if (!id.success) return {write_status: "partial_or_unknown", collection, templates: [], action: "Collection exists but ID cannot safely be used; inspect library"};
      const templates = [];
      for (const [index, workout] of payload.workouts.entries()) {
        try {templates.push(await client.createTemplate(id.data, workout));}
        catch (error) {return {write_status: "partial_or_unknown", collection, templates, failed_template_index: index,
          failure: failure(error), unattempted_templates: payload.workouts.slice(index + 1).map(w => w.title),
          action: "Inspect collection with get_saved_library(view:full). Do not repeat the whole program or uncertain template."};}
      }
      return {write_status: "complete", collection, templates, repeat_warning: "Created successfully. Do not repeat this request."};
    }, true);
  const templateInput = z.object({collection_id: positive, workout: workoutSchema}).strict();
  register("preview_workout_template", "Validate a workout and live catalog references, verify target collection exists, and issue a signed receipt for explicit confirmation. Does not create records.",
    templateInput, async payload => {
      parseResponse(z.object({data: savedSchema}), await client.request("GET", "/api/v1/collections/" + payload.collection_id));
      return {valid: true, preview: payload, validation: await validateIdentities(client, [payload.workout]),
        ...await signPreview(previewSecret, {kind: "template", ...payload}), confirmation_required: true};
    });
  register("create_workout_template", "WRITE: publish one previously previewed template into the chosen collection after explicit user confirmation. Payload and receipt must match. No retries; on uncertain failure read back the collection before any repetition.",
    templateInput.extend({preview_token: token, confirm: z.literal(true)}).strict(), async ({preview_token, confirm: _confirm, ...payload}) => {
      await verifyPreview(previewSecret, {kind: "template", ...payload}, preview_token);
      await validateIdentities(client, [payload.workout]);
      return {write_status: "complete", template: await client.createTemplate(payload.collection_id, payload.workout)};
    }, true);
  register("analyze_training", "Analyze current vs previous 7/14/30/90-day (or custom) periods: completed sessions/sets, unit-separated volume, exercise weight/Epley trends, PR markers, consistency, possible plateaus and muscle distribution. Bounded coverage diagnostics qualify all conclusions.",
    analysisSchema, args => training(client, args));
  register("analyze_muscle_load", "Read rolling and Monday-UTC weekly direct/indirect set distribution, per-workout muscles, prior-period changes and related-muscle comparisons. Secondary weighting is configurable and heuristic; zeros may reflect missing metadata.",
    analysisSchema, async args => {const report = await training(client, args); return {muscles: report.muscles, muscle_changes: report.muscle_changes,
      related_muscle_comparisons: report.related_muscle_comparisons, completeness: report.completeness};});
  register("estimate_recovery", "Return observed training timestamps, calculated elapsed time/load/exposure and optional self-report. Does not measure recovery/readiness or expose Lyfta's private recovery percentage. No fixed rest window proves recovery.",
    analysisSchema.extend({self_report: z.object({soreness: z.number().min(0).max(10).optional(), sleep_hours: z.number().min(0).max(24).optional(),
      fatigue: z.number().min(0).max(10).optional(), pain: z.string().max(500).optional(), perceived_readiness: z.number().min(0).max(10).optional()}).strict().optional()}).strict(),
    async args => {const report = await training(client, args); return {
      observed: {source: "Lyfta completed-set markers and catalog associations", self_report: args.self_report ?? null},
      calculated: report.muscles, workload_changes: report.muscle_changes,
      heuristics: {secondary_weight: args.secondary_weight, repeated_exposure: "See recorded_sessions and weekly_sets; no recovery threshold is inferred"},
      unavailable: ["Lyfta in-app recovery percentage", "Physiological recovery", "Measured readiness", "Unrecorded training"],
      completeness: report.completeness, interpretation: report.muscles.interpretation};});
  return server;
}
