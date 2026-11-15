import { z } from "zod";
import {createdSchema, exercisePageSchema, progressSchema, searchPageSchema, workoutPageSchema} from "./contracts.js";
import type {Collection, WorkoutTemplate} from "./schema.js";
export type ApiQuery = Record<string, string | number | undefined>;
export class LyftaApiError extends Error {
  constructor(public readonly statusCode: number, message: string, public readonly retryAfter?: string,
    public readonly outcomeUnknown = false) {super(message); this.name = "LyftaApiError";}
}
export function parseResponse<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new LyftaApiError(502, "Lyfta response contract is incomplete or malformed");
  return parsed.data;
}
/** Bound bytes before buffering, including chunked bodies. */
export async function boundedText(body: ReadableStream<Uint8Array> | null, maxBytes: number): Promise<string> {
  if (!body) return "";
  const reader = body.getReader(), decoder = new TextDecoder();
  let bytes = 0, value = "";
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > maxBytes) {await reader.cancel(); throw new LyftaApiError(413, "Response exceeds byte limit");}
      value += decoder.decode(chunk.value, {stream: true});
    }
    return value + decoder.decode();
  } finally {reader.releaseLock();}
}
interface Options {timeoutMs?: number; retries?: number; sleep?: (ms: number) => Promise<void>;}
export class LyftaClient {
  private calls = 0;
  private receivedBytes = 0;
  private readonly started = Date.now();
  constructor(private readonly key: string, private readonly fetcher: typeof fetch = fetch,
    private readonly baseUrl = "https://my.lyfta.app", private readonly options: Options = {}) {}
  async request(method: "GET" | "POST", path: string, query?: ApiQuery, body?: unknown): Promise<unknown> {
    if (!this.key.trim()) throw new LyftaApiError(503, "Lyfta credential is not configured");
    if (!/^\/api\/v1\/[a-z0-9/]+$/.test(path)) throw new LyftaApiError(400, "Invalid API path");
    const url = new URL(path, this.baseUrl);
    for (const [name, value] of Object.entries(query ?? {})) if (value !== undefined) url.searchParams.set(name, String(value));
    const retries = method === "GET" ? Math.min(2, this.options.retries ?? 2) : 0;
    for (let attempt = 0; ; attempt++) {
      if (++this.calls > 36 || Date.now() - this.started > 25_000)
        throw new LyftaApiError(429, "Per-call API request/time budget exhausted; narrow the request");
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.options.timeoutMs ?? 8000);
      try {
        const response = await this.fetcher(url.toString(), {method, redirect: "error", signal: controller.signal,
          headers: {Authorization: "Bearer " + this.key, Accept: "application/json",
            ...(body === undefined ? {} : {"Content-Type": "application/json"})},
          ...(body === undefined ? {} : {body: JSON.stringify(body)})});
        if (!response.ok) {
          await response.body?.cancel();
          const retryAfter = response.headers.get("Retry-After") ?? undefined;
          const delay = retryAfter === undefined ? 200 * 2 ** attempt : /^\d+(\.\d+)?$/.test(retryAfter)
            ? Number(retryAfter) * 1000 : Date.parse(retryAfter) - Date.now();
          if (method === "GET" && attempt < retries && (response.status === 429 || response.status >= 500)
            && Number.isFinite(delay) && delay >= 0 && delay <= 2000) {
            clearTimeout(timer); await this.pause(delay); continue;
          }
          throw new LyftaApiError(response.status, "Lyfta API request failed (HTTP " + response.status + ")",
            retryAfter, method === "POST" && ![401, 403, 404].includes(response.status));
        }
        const text = await boundedText(response.body, 2_000_000);
        this.receivedBytes += new TextEncoder().encode(text).byteLength;
        if (this.receivedBytes > 8_000_000) throw new LyftaApiError(413, "Aggregate API byte budget exhausted");
        let data: unknown;
        try {data = JSON.parse(text);} catch {throw new LyftaApiError(502, "Lyfta returned invalid JSON", undefined, method === "POST");}
        if (path === "/api/v1/me") return parseResponse(z.object({id: z.number().int().positive()}), data);
        const envelope = z.object({status: z.boolean()}).safeParse(data);
        if (!envelope.success || !envelope.data.status)
          throw new LyftaApiError(502, "Lyfta returned an unsuccessful or invalid envelope", undefined, method === "POST");
        return data;
      } catch (error) {
        if (error instanceof LyftaApiError) {
          if (method === "POST" && error.statusCode === 413) throw new LyftaApiError(413, error.message, undefined, true);
          throw error;
        }
        if (method === "GET" && attempt < retries) {clearTimeout(timer); await this.pause(200 * 2 ** attempt); continue;}
        throw new LyftaApiError(0, "Lyfta network request failed or timed out", undefined, method === "POST");
      } finally {clearTimeout(timer);}
    }
  }
  private pause(ms: number) {return (this.options.sleep ?? (delay => new Promise(resolve => setTimeout(resolve, delay))))(ms);}
  async workouts(page = 1, limit = 100, from?: string, to?: string) {return parseResponse(workoutPageSchema, await this.request("GET", "/api/v1/workouts", {page, limit, from, to}));}
  async summaries(page = 1, limit = 50) {return parseResponse(workoutPageSchema, await this.request("GET", "/api/v1/workouts/summary", {page, limit}));}
  async performedExercises(page = 1, limit = 100) {return parseResponse(exercisePageSchema, await this.request("GET", "/api/v1/exercises", {page, limit}));}
  async searchExercises(search: string, limit = 50, offset = 0) {return parseResponse(searchPageSchema, await this.request("GET", "/api/v1/exercises/library", {search, limit, offset}));}
  async progress(exercise_id: string, duration: number) {return parseResponse(progressSchema, await this.request("GET", "/api/v1/exercises/progress", {exercise_id, duration}));}
  async createCollection(collection: Collection) {return this.created("/api/v1/collections", {collection});}
  async createTemplate(collectionId: number, workout: WorkoutTemplate) {return this.created("/api/v1/templates", {collectionId, workout});}
  private async created(path: string, body: unknown) {
    const parsed = createdSchema.safeParse(await this.request("POST", path, undefined, body));
    if (!parsed.success) throw new LyftaApiError(502, "Create response missing record identity; inspect saved library before repeating", undefined, true);
    return parsed.data.data;
  }
}
