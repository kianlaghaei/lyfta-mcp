import {describe, expect, it} from "vitest";
import {analyzeMuscles, ids} from "../src/analysis.js";

describe("muscle analysis", () => {
  it("parses encoded exercise muscle IDs safely", () => {
    expect(ids('["24","25"]')).toEqual(["24","25"]);
    expect(ids(["1",2])).toEqual(["1","2"]);
    expect(ids("not-json")).toEqual([]);
  });
  it("counts completed sets for targets and weighted secondary sets", () => {
    const exercise = {id:"12", name:"Press", Target_muscles_id:'["24","25"]', Synergist_muscles_id:'["44"]'};
    const workouts = [{
      workout_perform_date:"2026-11-14T12:00:00Z",
      exercises:[{exercise_id:12, sets:[{is_completed:true,reps:"10"},{is_completed:true,reps:"8"},{is_completed:false}]}]
    }];
    const report = analyzeMuscles(workouts, [exercise], 7, new Date("2026-11-15T12:00:00Z"));
    expect(report.diagnostics.counted_sets).toBe(2);
    expect(report.muscle_load.find(m => m.muscle_id === "24")?.direct_sets).toBe(2);
    expect(report.muscle_load.find(m => m.muscle_id === "44")?.secondary_set_equivalents).toBe(1);
    expect(report.muscle_load[0]?.timing_category).toBe("24_to_48h");
  });
  it("does not treat unknown exercise metadata as confirmed muscle training", () => {
    const report = analyzeMuscles([{workout_perform_date:"2026-11-14T12:00:00Z", exercises:[{exercise_id:99, sets:[{}]}]}],
      [], 7, new Date("2026-11-15T12:00:00Z"));
    expect(report.muscle_load).toEqual([]);
    expect(report.diagnostics.unmatched_exercises).toBe(1);
  });
});
