import type {CatalogExercise} from "./contracts.js";
import {LyftaClient} from "./lyfta-client.js";
import {MUSCLES} from "./analysis.js";
import {decodeIds} from "./contracts.js";
export {decodeIds} from "./contracts.js";

// Official Lyfta ID tables, verified 2026-11-15. Unknown IDs stay visible.
export const EQUIPMENT: Record<string, string> = Object.fromEntries([
  "Barbell", "Body weight", "Cable", "Dumbbell", "EZ Barbell", "Leverage machine", "Sled machine", "Smith machine",
  "Weighted", "Assisted", "Band", "Battling Rope", "Bosu ball", "Hammer", "Kettlebell", "Medicine Ball",
  "Olympic barbell", "Power Sled", "Resistance Band", "Roll", "Rollball", "Rope", "Stability ball", "Stick",
  "Suspension", "Trap bar", "Vibrate Plate", "Wheel roller"
].map((name, index) => [String(index + 1), name]));
export const BODY_PARTS: Record<string, string> = Object.fromEntries([
  "Thighs", "Chest", "Hips", "Back", "Upper Arms", "Shoulders", "Forearms", "Calves", "Neck", "Cardio", "Full body",
  "Waist", "Plyometrics", "Weightlifting", "Yoga", "Stretching", "Biceps", "Triceps", "Quadriceps", "Hamstrings"
].map((name, index) => [String(index + 1), name]));
export function normalizeExercise(ex: CatalogExercise) {
  const fields = {equipment: ex.equipment_id, body_parts: ex.body_part_id,
    primary_muscles: ex.Target_muscles_id, secondary_muscles: ex.Synergist_muscles_id};
  const tables = {equipment: EQUIPMENT, body_parts: BODY_PARTS, primary_muscles: MUSCLES, secondary_muscles: MUSCLES};
  const map = (key: keyof typeof fields) => decodeIds(fields[key]).ids.map(id => ({id, name: tables[key][id] ?? null}));
  return {id: String(ex.id), name: ex.name ?? null, type: ex.exercise_type ?? null, image: ex.image_name ?? null,
    equipment: map("equipment"), body_parts: map("body_parts"), primary_muscles: map("primary_muscles"), secondary_muscles: map("secondary_muscles"),
    missing_fields: [!ex.name && "name", ex.exercise_type == null && "exercise_type", !ex.image_name && "image_name",
      ...Object.keys(fields).filter((key): key is keyof typeof fields => key in fields).filter(key => !decodeIds(fields[key]).valid)]
      .filter((key): key is string => typeof key === "string")};
}
export interface Filters {equipment_id?: string; body_part_id?: string; primary_muscle_id?: string; secondary_muscle_id?: string;}
export async function searchCatalog(client: LyftaClient, search: string, limit: number, offset: number, maxPages: number, filters: Filters) {
  const records = new Map<string, CatalogExercise>();
  let next = offset, hasMore = true, scanned = 0, total = 0;
  for (let page = 0; page < maxPages && hasMore && records.size < limit; page++) {
    const data = (await client.searchExercises(search, 50, next)).data;
    if (data.pagination.offset !== next) throw new Error("Catalog pagination did not advance");
    total = data.pagination.total;
    hasMore = data.pagination.hasMore;
    for (const [index, ex] of data.results.entries()) {
      scanned++; next++;
      if (filters.equipment_id && !decodeIds(ex.equipment_id).ids.includes(filters.equipment_id)) continue;
      if (filters.body_part_id && !decodeIds(ex.body_part_id).ids.includes(filters.body_part_id)) continue;
      if (filters.primary_muscle_id && !decodeIds(ex.Target_muscles_id).ids.includes(filters.primary_muscle_id)) continue;
      if (filters.secondary_muscle_id && !decodeIds(ex.Synergist_muscles_id).ids.includes(filters.secondary_muscle_id)) continue;
      records.set(String(ex.id), ex);
      if (records.size >= limit) {hasMore = hasMore || index < data.results.length - 1; break;}
    }
    if (!data.results.length && hasMore) throw new Error("Catalog pagination stalled");
  }
  const selected = [...records.values()].slice(0, limit);
  return {exercises: selected.map(normalizeExercise), diagnostics: {scanned, total_search_matches: total,
    local_filters: true, complete: !hasMore && records.size <= limit && offset === 0,
    next_offset: hasMore ? next : null, coverage: "Filters cover retrieved catalog pages only"}};
}
