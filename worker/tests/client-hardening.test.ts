import {describe, expect, it, vi} from "vitest";
import {boundedText, LyftaClient} from "../src/lyfta-client.js";
import {workout} from "./fixtures.js";
const noWait = async (_ms = 0) => {};
describe("HTTP failure and resource boundaries", () => {
  it.each([400, 401, 403, 404, 429, 500])("sanitizes HTTP %i and never retries POST", async status => {
    const fetcher = vi.fn<typeof fetch>(async () => new Response("secret-key-in-untrusted-body", {status, headers: {"Retry-After": "30"}}));
    const client = new LyftaClient("secret-key", fetcher, undefined, {sleep: noWait});
    await expect(client.createTemplate(42, workout)).rejects.toMatchObject({statusCode: status});
    expect(fetcher).toHaveBeenCalledTimes(1);
    try {await client.request("POST", "/api/v1/templates", undefined, {});} catch (error) {expect(String(error)).not.toContain("secret-key");}
  });
  it.each([400, 401, 403, 404])("does not retry unsafe-to-repeat GET failure %i", async status => {
    const fetcher = vi.fn<typeof fetch>(async () => new Response("", {status}));
    await expect(new LyftaClient("key", fetcher).workouts()).rejects.toMatchObject({statusCode: status});
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it.each([429, 500, 503])("retries safe GET %i with bounded backoff", async status => {
    const sleep = vi.fn(noWait);
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response("", {status}))
      .mockResolvedValueOnce(Response.json({status: true, workouts: []}));
    await new LyftaClient("key", fetcher, undefined, {sleep}).workouts();
    expect(fetcher).toHaveBeenCalledTimes(2); expect(sleep).toHaveBeenCalledWith(200);
  });
  it("stops after two retries", async () => {
    const fetcher = vi.fn<typeof fetch>(async () => new Response("", {status: 500}));
    const sleep = vi.fn(noWait);
    await expect(new LyftaClient("key", fetcher, undefined, {sleep}).workouts()).rejects.toMatchObject({statusCode: 500});
    expect(fetcher).toHaveBeenCalledTimes(3); expect(sleep.mock.calls.map(c => c[0])).toEqual([200, 400]);
  });
  it("does not wait beyond bounded Retry-After", async () => {
    const fetcher = vi.fn<typeof fetch>(async () => new Response("", {status: 429, headers: {"Retry-After": "60"}}));
    await expect(new LyftaClient("key", fetcher).workouts()).rejects.toMatchObject({retryAfter: "60"});
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("times out with a sanitized error and no POST retry", async () => {
    const fetcher = vi.fn<typeof fetch>((_url, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new Error("SECRET network details")));
    }));
    await expect(new LyftaClient("key", fetcher, undefined, {timeoutMs: 5}).createTemplate(42, workout))
      .rejects.toMatchObject({statusCode: 0, outcomeUnknown: true, message: "Lyfta network request failed or timed out"});
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("retries network GET failures only", async () => {
    const fetcher = vi.fn<typeof fetch>().mockRejectedValueOnce(new Error("secret"))
      .mockResolvedValueOnce(Response.json({status: true, workouts: []}));
    await new LyftaClient("key", fetcher, undefined, {sleep: noWait}).workouts(); expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it.each(["not-json", JSON.stringify({status: false, message: "SECRET"}), JSON.stringify({status: true}), JSON.stringify({status: true, workouts: [{id: "bad"}]})])
    ("rejects malformed/incomplete envelope %s", async body => {
      const fetcher = vi.fn<typeof fetch>(async () => new Response(body));
      await expect(new LyftaClient("key", fetcher).workouts()).rejects.toThrow(); expect(fetcher).toHaveBeenCalledTimes(1);
    });
  it("bounds a chunked multibyte body and cancels the stream", async () => {
    const cancel = vi.fn();
    const stream = new ReadableStream({pull(c) {c.enqueue(new TextEncoder().encode("ééé"));}, cancel});
    await expect(boundedText(stream, 5)).rejects.toMatchObject({statusCode: 413}); expect(cancel).toHaveBeenCalled();
  });
  it("keeps timeout active through body streaming", async () => {
    const fetcher: typeof fetch = async (_url, init) => new Response(new ReadableStream({start(controller) {
      init?.signal?.addEventListener("abort", () => controller.error(new Error("aborted")));
    }}));
    await expect(new LyftaClient("key", fetcher, undefined, {timeoutMs: 5, retries: 0}).workouts()).rejects.toMatchObject({statusCode: 0});
  });
  it("encodes queries, sets headers and refuses redirects", async () => {
    const fetcher = vi.fn<typeof fetch>(async () => Response.json({status: true}));
    await new LyftaClient("secret", fetcher).request("GET", "/api/v1/exercises/library", {search: "A & B/+", offset: 0});
    const [url, init] = fetcher.mock.calls[0]!;
    expect(new URL(String(url)).searchParams.get("search")).toBe("A & B/+");
    expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer secret"); expect(init?.redirect).toBe("error");
  });
  it("requires an ID in successful create response", async () => {
    await expect(new LyftaClient("key", async () => Response.json({status: true, data: {}})).createTemplate(42, workout))
      .rejects.toMatchObject({outcomeUnknown: true});
  });
  it("fails closed without a key", async () => {
    const fetcher = vi.fn<typeof fetch>(); await expect(new LyftaClient("", fetcher).workouts()).rejects.toThrow();
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("supports documented /me without status envelope", async () => {
    expect(await new LyftaClient("key", async () => Response.json({id: 123})).request("GET", "/api/v1/me")).toEqual({id: 123});
  });
});
