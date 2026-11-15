import {LyftaClient} from "./lyfta-client.js";
interface Page<T> {items: T[]; total_pages?: number; current_page?: number;}
/** No ordering assumptions: exhaust the bounded range, deduplicate by stable ID. */
export async function collectPages<T extends {id: string | number}>(fetchPage: (page: number) => Promise<Page<T>>,
  start = 1, maxPages = 5) {
  const records = new Map<string, T>();
  let duplicates = 0, pages = 0, complete = false, reason = "page_budget", nextPage = start;
  for (let page = start; page < start + maxPages; page++) {
    const response = await fetchPage(page); pages++; nextPage = page + 1;
    if (response.current_page !== undefined && response.current_page !== page) {reason = "page_did_not_advance"; break;}
    let added = 0;
    for (const item of response.items) {
      if (records.has(String(item.id))) duplicates++; else {records.set(String(item.id), item); added++;}
    }
    if (response.total_pages !== undefined && page >= response.total_pages) {complete = start === 1; reason = start === 1 ? "total_pages" : "noninitial_page"; break;}
    if (!response.items.length) {complete = start === 1; reason = "empty_page"; break;}
    if (!added) {reason = "repeated_page"; break;}
  }
  return {records: [...records.values()], diagnostics: {complete, reason, pages_fetched: pages,
    duplicates_removed: duplicates, next_page: complete ? null : nextPage, start_page: start}};
}
export function collectExercises(client: LyftaClient, maxPages = 5) {
  return collectPages(async page => {const result = await client.performedExercises(page); return {...result, items: result.exercises};}, 1, maxPages);
}
export function collectWorkouts(client: LyftaClient, from: string, to: string, maxPages = 5) {
  return collectPages(async page => {const result = await client.workouts(page, 100, from, to); return {...result, items: result.workouts};}, 1, maxPages);
}
