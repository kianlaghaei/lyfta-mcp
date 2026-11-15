import {describe, expect, it, vi} from "vitest";
import {LyftaApiError, LyftaClient} from "../src/lyfta-client.js";

describe("LyftaClient", () => {
  it("sends key only in bearer header and normalizes query parameters", async () => {
    const fetcher = vi.fn(async () => Response.json({status:true, workouts:[]}));
    const client = new LyftaClient("mock-key", fetcher as typeof fetch);
    await client.workouts(2, 10);
    const [url, config] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain("/api/v1/workouts?page=2&limit=10");
    expect(url).not.toContain("mock-key");
    expect((config.headers as Record<string, string>).Authorization).toBe("Bearer mock-key");
  });
  it("sends the documented collectionId as an integer", async () => {
    const fetcher = vi.fn(async () => Response.json({status:true, data:{id:7}}));
    const client = new LyftaClient("test", fetcher as typeof fetch);
    await client.createTemplate(42, {title:"Push", exercises:[]});
    const body = JSON.parse((fetcher.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
    expect(body.collectionId).toBe(42);
    expect(body.workout.title).toBe("Push");
  });
  it("reports rate limits without swallowing retry-after", async () => {
    const fetcher = vi.fn(async () => new Response('{"message":"slow down"}', {
      status: 429, headers: {"Retry-After":"30"}
    }));
    const client = new LyftaClient("test", fetcher as typeof fetch);
    await expect(client.performedExercises()).rejects.toMatchObject({
      name: "LyftaApiError", statusCode:429, retryAfter:"30"
    } satisfies Partial<LyftaApiError>);
  });
});
