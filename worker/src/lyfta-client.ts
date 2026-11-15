/** Minimal, runtime-neutral API client; never expose the Lyfta key to MCP callers. */
export type ApiQuery = Record<string, string | number | undefined>;
export type ApiPayload = Record<string, unknown>;

export class LyftaApiError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
    public readonly retryAfter?: string
  ) {
    super(message);
    this.name = "LyftaApiError";
  }
}

export class LyftaClient {
  constructor(
    private readonly key: string,
    private readonly fetcher: typeof fetch = fetch,
    private readonly baseUrl = "https://my.lyfta.app"
  ) {}

  async request(method: "GET" | "POST", path: string, query?: ApiQuery, body?: unknown): Promise<unknown> {
    if (!this.key) throw new Error("LYFTA_API_KEY is not configured.");
    const url = new URL(path, this.baseUrl);
    for (const [name, value] of Object.entries(query ?? {})) {
      if (value !== undefined) url.searchParams.set(name, String(value));
    }
    let response: Response;
    try {
      response = await this.fetcher(url.toString(), {
        method,
        headers: {
          Authorization: "Bearer " + this.key,
          Accept: "application/json",
          ...(body === undefined ? {} : { "Content-Type": "application/json" })
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(15_000)
      });
    } catch (error) {
      throw new LyftaApiError(0, error instanceof Error ? error.message : "Network failure");
    }
    if (response.status === 429) {
      throw new LyftaApiError(429, "Lyfta API rate limit exceeded", response.headers.get("Retry-After") ?? undefined);
    }
    // API response size is bounded to prevent excessive Worker memory consumption.
    const length = Number(response.headers.get("Content-Length") ?? "0");
    if (length > 4_000_000) throw new LyftaApiError(response.status, "API response exceeds size limit");
    const text = await response.text();
    if (text.length > 4_000_000) throw new LyftaApiError(response.status, "API response exceeds size limit");
    let data: unknown;
    try {
      data = text ? JSON.parse(text) as unknown : {};
    } catch {
      throw new LyftaApiError(response.status, "Lyfta API returned invalid JSON");
    }
    const record = typeof data === "object" && data !== null ? data as Record<string, unknown> : {};
    if (!response.ok || record.status === false) {
      const msg = typeof record.message === "string" ? record.message : "API request failed";
      throw new LyftaApiError(response.status, msg.substring(0, 300));
    }
    return data;
  }

  workouts(page = 1, limit = 30) { return this.request("GET", "/api/v1/workouts", {page, limit}); }
  summaries(page = 1, limit = 50) { return this.request("GET", "/api/v1/workouts/summary", {page, limit}); }
  performedExercises(page = 1, limit = 100) { return this.request("GET", "/api/v1/exercises", {page, limit}); }
  searchExercises(search: string, limit = 20, offset = 0) {
    return this.request("GET", "/api/v1/exercises/library", {search, limit, offset});
  }
  progress(exercise_id: string, duration: number) {
    return this.request("GET", "/api/v1/exercises/progress", {exercise_id, duration});
  }
  createCollection(collection: {title: string; description?: string; goal?: string}) {
    return this.request("POST", "/api/v1/collections", undefined, {collection});
  }
  createTemplate(collectionId: number, workout: Record<string, unknown>) {
    return this.request("POST", "/api/v1/templates", undefined, {collectionId, workout});
  }
}
