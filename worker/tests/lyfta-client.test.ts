import {describe, expect, it, vi} from "vitest";
import {LyftaApiError, LyftaClient} from "../src/lyfta-client.js";

describe("LyftaClient", () => {
  it("sends key only in bearer header and normalizes query parameters", async () => {
    const fetcher = vi.fn<typeof fetch>(async () => Response.json({status:true, workouts:[]}));
    const client = new LyftaClient("mock-key", fetcher);
    await client.workouts(2, 10);
    const [url, config] = fetcher.mock.calls[0]!;
    expect(url).toContain("/api/v1/workouts?page=2&limit=10");
    expect(url).not.toContain("mock-key");
    expect(new Headers(config?.headers).get("Authorization")).toBe("Bearer mock-key");
    expect(config?.redirect).toBe("manual"); // Cloudflare runtime rejects redirect:"error".
    expect(fetcher.mock.contexts[0]).toBe(globalThis); // Cloudflare global fetch rejects an unrelated this.
  });
  it("never follows redirects that might leak the API bearer token", async () => {
    const fetcher = vi.fn<typeof fetch>(async () => new Response(null, {
      status:302, headers:{Location:"https://redirect.invalid"}
    }));
    const client = new LyftaClient("secret-key", fetcher);
    await expect(client.performedExercises()).rejects.toMatchObject({statusCode:302});
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0]?.[1]?.redirect).toBe("manual");
  });
  it("sends the documented collectionId as an integer", async () => {
    const fetcher = vi.fn<typeof fetch>(async () => Response.json({status:true, data:{id:7}}));
    const client = new LyftaClient("test", fetcher);
    await client.createTemplate(42, {title:"Push", exercises:[]});
    const body = JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body));
    expect(body.collectionId).toBe(42);
    expect(body.workout.title).toBe("Push");
  });
  it("reports rate limits without swallowing retry-after", async () => {
    const fetcher = vi.fn<typeof fetch>(async () => new Response('{"message":"slow down"}', {
      status: 429, headers: {"Retry-After":"30"}
    }));
    const client = new LyftaClient("test", fetcher);
    await expect(client.performedExercises()).rejects.toMatchObject({
      name: "LyftaApiError", statusCode:429, retryAfter:"30"
    } satisfies Partial<LyftaApiError>);
  });
});
