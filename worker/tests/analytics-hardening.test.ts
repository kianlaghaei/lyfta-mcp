import {describe, expect, it} from "vitest";
import {analyzeMuscles, analyzeTraining, numeric, timeOf} from "../src/analysis.js";
import {collectPages, collectWorkouts} from "../src/history.js";
import {decodeIds, normalizeExercise, searchCatalog} from "../src/catalog.js";
import {LyftaClient} from "../src/lyfta-client.js";
import {programSchema, workoutSchema} from "../src/schema.js";
import {signPreview, verifyPreview} from "../src/program.js";
import {exercise, logged, program, secret, workout} from "./fixtures.js";
const now = new Date("2026-11-15T12:00:00Z");
describe("analysis evidence", () => {
  it("never treats missing completion markers or planned sets as completed", () => {
    const result = analyzeMuscles([logged(1, "2026-11-14T12:00:00Z")], [exercise], 7, now);
    expect(result.diagnostics).toMatchObject({counted_sets: 1, unknown_completion_sets: 1, incomplete_sets: 1});
    expect(result.muscle_load.find(m => m.muscle_id === "27")?.direct_sets).toBe(1);
    expect(result.muscle_load.find(m => m.muscle_id === "32")?.secondary_set_equivalents).toBe(0.5);
  });
  it("records secondary involvement with zero heuristic weight", () => {
    const result = analyzeMuscles([logged(1, "2026-11-14T12:00:00Z")], [exercise], 7, now, 0);
    expect(result.muscle_load.find(m => m.muscle_id === "32")).toMatchObject({direct_sets: 0, secondary_set_equivalents: 0, hours_since_last_workout: 24});
  });
  it("does not double count primary/secondary overlap or duplicate muscle IDs", () => {
    const result = analyzeMuscles([logged(1, "2026-11-14T12:00:00Z")], [{...exercise, Target_muscles_id: '["27","27"]', Synergist_muscles_id: '["27","32"]'}], 7, now);
    expect(result.muscle_load.find(m => m.muscle_id === "27")).toMatchObject({direct_sets: 1, secondary_set_equivalents: 0});
  });
  it("counts completed sets while separately diagnosing unknown muscle mapping", () => {
    const result = analyzeMuscles([logged(1, "2026-11-14T12:00:00Z")], [], 7, now);
    expect(result.diagnostics).toMatchObject({counted_sets: 1, unmatched_exercises: 1}); expect(result.muscle_load).toEqual([]);
  });
  it("reports missing versus empty muscle metadata", () => {
    const result = analyzeMuscles([logged(1, "2026-11-14T12:00:00Z")], [{...exercise, Target_muscles_id: "bad", Synergist_muscles_id: "[]"}], 7, now);
    expect(result.diagnostics).toMatchObject({missing_primary_mappings: 1, missing_secondary_mappings: 0});
  });
  it("excludes invalid, missing and future dates", () => {
    const result = analyzeMuscles([logged(1, "invalid"), {...logged(2, ""), workout_perform_date: null}, logged(3, "2026-11-16T00:00:00Z")], [exercise], 7, now);
    expect(result.diagnostics).toMatchObject({invalid_dates: 2, future_dates: 1, analyzed_workouts: 0});
  });
  it.each(["2026-02-30", "11/14/2026", "2026-11-14garbage", "2026-13-01", ""])("rejects ambiguous or invalid timestamp %s", date => expect(Number.isNaN(timeOf(date))).toBe(true));
  it("normalizes explicit offsets, date-only and unzoned timestamps to UTC", () => {
    expect(timeOf("2026-11-15T00:30:00+03:30")).toBe(Date.parse("2026-11-14T21:00:00Z"));
    expect(timeOf("2026-11-14 12:00:00")).toBe(Date.parse("2026-11-14T12:00:00Z"));
    expect(timeOf("2026-11-14")).toBe(Date.parse("2026-11-14T00:00:00Z"));
  });
  it("keeps kg and lb separate and excludes unknown units from volume", () => {
    const result = analyzeTraining([logged(1, "2026-11-14", "kg"), logged(2, "2026-11-13", "lb"), logged(3, "2026-11-12", null)], [exercise], 7, now);
    expect(result.current.volume_by_weight_unit).toEqual({kg: 600, lb: 600});
    expect(result.current.sets_excluded_from_volume).toBe(1); expect(result.current.completed_repetitions).toBe(30);
  });
  it("does not double count the boundary between current and previous periods", () => {
    const result = analyzeTraining([logged(1, "2026-11-08T12:00:00Z"), logged(2, "2026-11-08T11:59:59Z")], [exercise], 7, now);
    expect(result.current.recorded_completed_sessions).toBe(1); expect(result.previous.recorded_completed_sessions).toBe(1);
    expect(result.muscle_changes.find(m => m.muscle_id === "27")?.direct_set_change).toBe(0);
  });
  it("computes sorted exercise trends and labels repeated weights as an observation", () => {
    const result = analyzeTraining([logged(3, "2026-11-14"), logged(1, "2026-11-12"), logged(2, "2026-11-13")], [exercise], 7, now);
    expect(result.current.exercises[0]?.weight_change).toBe(0);
    expect(result.current.exercises[0]?.points[0]?.estimated_1rm).toBe(80);
    expect(result.current.exercises[0]?.possible_plateau_observation).toContain("programming intent");
    expect(result.missed_scheduled_sessions).toBeNull();
  });
  it("returns descriptive weekly distribution and a supplied session target", () => {
    const result = analyzeTraining([logged(1, "2026-11-14")], [exercise], 7, now, 0.5, 3);
    expect(result.session_target_shortfall).toBe(2); expect(result.weekly_frequency).toBe(1);
    expect(result.muscles.muscle_load[0]?.weekly_sets[0]?.week_start_utc).toBe("2026-11-09");
    expect(result.muscles.interpretation).toContain("unavailable");
  });
  it.each(["", null, undefined, "abc", "-2", "1e3"])("does not invent a number for %s", v => expect(numeric(v)).toBeNull());
});
describe("pagination and verified mappings", () => {
  it("collects overlapping workout pages, sending UTC filters, and deduplicates", async () => {
    const urls: URL[] = [];
    const client = new LyftaClient("key", async input => {
      const url = new URL(String(input)); urls.push(url); const page = Number(url.searchParams.get("page"));
      return Response.json({status: true, current_page: page, total_pages: 2, workouts: page === 1 ? [logged(1, "2026-11-14")] : [logged(1, "2026-11-14"), logged(2, "2026-11-13")]});
    });
    const result = await collectWorkouts(client, "2026-11-01", "2026-11-15");
    expect(result.records).toHaveLength(2); expect(result.diagnostics).toMatchObject({complete: true, duplicates_removed: 1, pages_fetched: 2});
    expect(urls.every(url => url.searchParams.get("from") === "2026-11-01")).toBe(true);
  });
  it("reports truncation, missing metadata and stalled pagination", async () => {
    const bounded = await collectPages(async page => ({items: [{id: page}], total_pages: 3}), 1, 1);
    expect(bounded.diagnostics).toMatchObject({complete: false, reason: "page_budget"});
    const repeated = await collectPages(async () => ({items: [{id: 1}]}));
    expect(repeated.diagnostics).toMatchObject({complete: false, reason: "repeated_page"});
    const wrongPage = await collectPages(async () => ({items: [{id: 1}], current_page: 1}), 2);
    expect(wrongPage.diagnostics.reason).toBe("page_did_not_advance");
  });
  it("maps official example exercise, muscle and equipment IDs", () => {
    expect(normalizeExercise(exercise)).toMatchObject({id: "31", name: "Rear Lunge", equipment: [{id: "1", name: "Barbell"}],
      primary_muscles: [{id: "13", name: "Gluteus Maximus"}, {id: "27", name: "Quadriceps"}],
      secondary_muscles: [{id: "3", name: "Adductor Magnus"}, {id: "32", name: "Soleus"}], missing_fields: []});
  });
  it("rejects malformed ID arrays and preserves unknown identifiers", () => {
    expect(decodeIds('[{}]')).toEqual({ids: [], valid: false});
    expect(normalizeExercise({...exercise, Target_muscles_id: '["999"]', exercise_type: null})).toMatchObject({primary_muscles: [{id: "999", name: null}], missing_fields: ["exercise_type"]});
  });
  it("locally filters catalog and returns a resumable cursor without skipping matches", async () => {
    const client = new LyftaClient("key", async input => {
      const offset = Number(new URL(String(input)).searchParams.get("offset"));
      return Response.json({status: true, data: {results: offset === 0 ? [{...exercise, id: 1, equipment_id: '["4"]'}, {...exercise, id: 2}, {...exercise, id: 3}] : [{...exercise, id: 3}],
        pagination: {limit: 50, offset, total: 3, hasMore: false}}});
    });
    const first = await searchCatalog(client, "", 1, 0, 2, {equipment_id: "1"});
    expect(first.exercises[0]?.id).toBe("2"); expect(first.diagnostics.next_offset).toBe(2);
    const next = await searchCatalog(client, "", 1, 2, 2, {primary_muscle_id: "27"}); expect(next.exercises[0]?.id).toBe("3");
  });
});
describe("creation schemas and receipt integrity", () => {
  it("supports documented ranges, RIR, rest, supersets, duration, distance and notes", () => {
    const rich = {...workout, description: "Example", note: "Synthetic", color: "#178B76", picture: "https://cdnlyfta.com/example.png", exercises: [{...workout.exercises[0]!,
      is_rep_range_active: true, exercise_note: "Controlled", exercise_superset_id: 1,
      sets: [{set_type_id: 0, from_reps: "8", to_reps: "12", weight: "20.5", rir: "2", duration: "60", distance: "5"}]}]};
    expect(workoutSchema.parse(rich)).toEqual(rich);
  });
  it.each([{title: " "}, {exercises: []}, {exercises: [{...workout.exercises[0]!, exercise_id: 0}]},
    {exercises: [{...workout.exercises[0]!, sets: [{weight: 60}]}]}, {exercises: [{...workout.exercises[0]!, sets: [{from_reps: "12", to_reps: "8"}]}]},
    {exercises: [{...workout.exercises[0]!, is_rep_range_active: true}]}, {picture: "https://evil.example/test"}])
    ("rejects invalid template %j", changes => expect(workoutSchema.safeParse({...workout, ...changes}).success).toBe(false));
  it("rejects coach fields and URL collection image", () => {
    expect(programSchema.safeParse({...program, client_id: "no"}).success).toBe(false);
    expect(programSchema.safeParse({...program, collection: {title: "test", image: "https://example.com/image"}}).success).toBe(false);
  });
  it("verifies a canonical receipt and rejects tampering, expiry and wrong secret", async () => {
    const receipt = await signPreview(secret, {a: 1, b: 2}, 1000);
    await expect(verifyPreview(secret, {b: 2, a: 1}, receipt.preview_token, 2000)).resolves.toBeUndefined();
    await expect(verifyPreview(secret, {a: 2, b: 2}, receipt.preview_token, 2000)).rejects.toThrow();
    await expect(verifyPreview(secret, {a: 1, b: 2}, receipt.preview_token, 602000)).rejects.toThrow();
    await expect(verifyPreview("other-credential-with-at-least-32-bytes", {a: 1, b: 2}, receipt.preview_token, 2000)).rejects.toThrow();
  });
});
