import {afterEach, describe, expect, it, vi} from "vitest";
import {createMcpHandler} from "@modelcontextprotocol/server";
import {z} from "zod";
import worker from "../src/index.js";
import {createServer} from "../src/server.js";
import {LyftaClient} from "../src/lyfta-client.js";
import {apiResponse, exercise, logged, program, secret, workout} from "./fixtures.js";
const env = {LYFTA_API_KEY: "synthetic-key", MCP_ACCESS_TOKEN: secret};
const rpcSchema = z.object({result: z.unknown().optional(), error: z.unknown().optional()});
const toolResultSchema = z.object({isError: z.boolean().optional(), content: z.array(z.object({type: z.string(), text: z.string().optional()})),
  structuredContent: z.object({data: z.record(z.string(), z.unknown())}).optional()});
export async function rpc(fetcher: (r: Request) => Promise<Response>, method: string, params?: unknown, protocol = "2025-06-18") {
  const response = await fetcher(new Request("http://localhost/mcp", {method: "POST", headers: {
    Authorization: "Bearer " + secret, "Content-Type": "application/json", Accept: "application/json, text/event-stream", "MCP-Protocol-Version": protocol,
    ...(protocol === "2026-07-28" ? {"Mcp-Method": method} : {})},
    body: JSON.stringify({jsonrpc: "2.0", id: 1, method, ...(params === undefined ? {} : {params})})}));
  const text = await response.text();
  const data = text.startsWith("event:") || text.startsWith("data:")
    ? JSON.parse(text.split("\n").find(line => line.startsWith("data:"))?.slice(5) ?? "{}") : JSON.parse(text);
  return {status: response.status, ...rpcSchema.parse(data)};
}
function harness(fetcher: typeof fetch = async (url, init) => apiResponse(String(url), init)) {
  const handler = createMcpHandler(() => createServer(new LyftaClient("synthetic-key", fetcher, undefined, {retries: 0}), secret), {maxSubscriptions: 0});
  const call = async (name: string, args: unknown) => toolResultSchema.parse((await rpc(handler.fetch, "tools/call", {name, arguments: args})).result);
  return {handler, call};
}
afterEach(() => vi.unstubAllGlobals());
describe("MCP protocol and authorization", () => {
  it("serves SDK v2 modern discover and tool listing with per-request metadata", async () => {
    const {handler} = harness();
    const params = {_meta: {"io.modelcontextprotocol/protocolVersion": "2026-07-28",
      "io.modelcontextprotocol/clientCapabilities": {}, "io.modelcontextprotocol/clientInfo": {name: "test", version: "1"}}};
    const discovery = await rpc(handler.fetch, "server/discover", params, "2026-07-28");
    expect(discovery.error).toBeUndefined(); expect(discovery.result).toBeDefined();
    const list = await rpc(handler.fetch, "tools/list", params, "2026-07-28");
    expect(list.error).toBeUndefined(); expect(list.result).toMatchObject({tools: expect.any(Array)});
  });
  it("initializes over stateless Streamable HTTP", async () => {
    const {handler} = harness();
    const init = await rpc(handler.fetch, "initialize", {protocolVersion: "2025-06-18", capabilities: {}, clientInfo: {name: "test", version: "1"}});
    expect(init.status).toBe(200); expect(init.error).toBeUndefined(); expect(init.result).toMatchObject({serverInfo: {name: "lyfta-personal"}});
  });
  it("lists focused tools, output schemas and write annotations", async () => {
    const {handler} = harness();
    const result = z.object({tools: z.array(z.object({name: z.string(), outputSchema: z.unknown(), annotations: z.object({readOnlyHint: z.boolean(), idempotentHint: z.boolean()})}))})
      .parse((await rpc(handler.fetch, "tools/list")).result);
    expect(result.tools).toHaveLength(12);
    expect(result.tools.find(t => t.name === "create_program")?.annotations).toMatchObject({readOnlyHint: false, idempotentHint: false});
    expect(result.tools.find(t => t.name === "search_exercises")?.annotations.readOnlyHint).toBe(true);
  });
  it.each([{}, {LYFTA_API_KEY: "key"}, {MCP_ACCESS_TOKEN: secret}, {LYFTA_API_KEY: "key", MCP_ACCESS_TOKEN: "short"}])
    ("fails closed with missing/invalid configuration %j", async config => {
      const result = await worker.fetch(new Request("http://localhost/mcp"), {LYFTA_API_KEY: config.LYFTA_API_KEY ?? "", MCP_ACCESS_TOKEN: config.MCP_ACCESS_TOKEN ?? ""});
      expect(result.status).toBe(503);
    });
  it.each([undefined, "Bearer incorrect", "Basic ignored"])("rejects unauthorized request %s", async auth => {
    const headers = new Headers(); if (auth) headers.set("Authorization", auth);
    const result = await worker.fetch(new Request("http://localhost/mcp", {headers}), env);
    expect(result.status).toBe(401); expect(result.headers.get("WWW-Authenticate")).toBe("Bearer");
  });
  it("rejects cross-origin browser requests", async () => {
    expect((await worker.fetch(new Request("http://localhost/mcp", {headers: {Authorization: "Bearer " + secret, Origin: "https://other.example"}}), env)).status).toBe(403);
  });
  it("has health and unknown-path behavior without credentials", async () => {
    expect((await worker.fetch(new Request("http://localhost/healthz"), env)).status).toBe(200);
    expect((await worker.fetch(new Request("http://localhost/unknown"), env)).status).toBe(404);
  });
  it("runs through the actual worker authorization and HTTP handler", async () => {
    vi.stubGlobal("fetch", vi.fn<typeof fetch>(async (url, init) => apiResponse(String(url), init)));
    const result = await rpc(r => worker.fetch(r, env), "tools/call", {name: "search_exercises", arguments: {search: "Lunge"}});
    expect(result.status).toBe(200); expect(toolResultSchema.parse(result.result).structuredContent?.data.exercises).toBeDefined();
  });
  it("rejects invalid and unknown input keys before calling Lyfta", async () => {
    const fetcher = vi.fn<typeof fetch>(); const {call} = harness(fetcher);
    expect((await call("search_exercises", {limit: -1})).isError).toBe(true);
    expect((await call("search_exercises", {client_id: "forbidden"})).isError).toBe(true);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("enforces the request byte cap", async () => {
    const r = await worker.fetch(new Request("http://localhost/mcp", {method: "POST", headers: {Authorization: "Bearer " + secret,
      "Content-Type": "application/json"}, body: " ".repeat(512_001)}), env);
    expect(r.status).toBe(413);
  });
  it("preserves structured output and suppresses unsafe upstream messages", async () => {
    const {call} = harness(async () => new Response("synthetic-key SECRET", {status: 401}));
    const result = await call("list_performed_exercises", {}); expect(result.isError).toBe(true);
    expect(JSON.stringify(result)).not.toContain("synthetic-key"); expect(JSON.stringify(result)).not.toContain("SECRET");
  });
});
describe("complete MCP read paths", () => {
  it("analyzes multiple history pages through the registered tool and exposes recovery gaps", async () => {
    const fetcher = vi.fn<typeof fetch>(async (url, init) => {
      const u = new URL(String(url));
      if (u.pathname === "/api/v1/workouts") {
        const page = Number(u.searchParams.get("page"));
        return Response.json({status: true, current_page: page, total_pages: 2,
          workouts: [logged(page, new Date(Date.now() - page * 86_400_000).toISOString())]});
      }
      return apiResponse(String(url), init);
    });
    const {call} = harness(fetcher);
    const report = await call("analyze_training", {days: 7});
    expect(report.structuredContent?.data.current).toMatchObject({recorded_completed_sessions: 2, completed_sets: 2});
    expect(report.structuredContent?.data.completeness).toMatchObject({workouts: {complete: true, pages_fetched: 2}});
    const recovery = await call("estimate_recovery", {days: 7, self_report: {sleep_hours: 6, fatigue: 3}});
    expect(recovery.structuredContent?.data.unavailable).toContain("Physiological recovery");
    expect(recovery.structuredContent?.data.observed).toMatchObject({self_report: {sleep_hours: 6, fatigue: 3}});
    expect(JSON.stringify(recovery)).not.toContain("recovery_percentage");
  });
  it.each(["collections", "templates", "collection", "template", "profile", "me", "schedule"] as const)("reads documented personal resource %s", async resource => {
    const fetcher = vi.fn<typeof fetch>(async () => Response.json(resource === "me" ? {id: 12} : resource === "collections"
      ? {status: true, collections: [], total_pages: 0} : resource === "templates" ? {status: true, templates: [], total_pages: 0}
      : resource === "schedule" ? {status: true, workouts: [], total_pages: 0} : {status: true, data: {id: 42}}));
    const result = await harness(fetcher).call("get_saved_library", {resource, id: 42});
    expect(result.isError).not.toBe(true); expect(fetcher).toHaveBeenCalledTimes(1);
    expect(new URL(String(fetcher.mock.calls[0]?.[0])).searchParams.has("client_id")).toBe(false);
  });
  it("requires integer progress identity, forwards duration and preserves Lyfta unit", async () => {
    const fetcher = vi.fn<typeof fetch>(async () => Response.json({status: true, weight_unit: "lb", data: [{date: "2026-11-14", best_weight: 100, estimated_rm: "133"}]}));
    const {call} = harness(fetcher); expect((await call("get_exercise_progress", {exercise_id: "not-an-id"})).isError).toBe(true);
    const result = await call("get_exercise_progress", {exercise_id: "31", duration_days: 30});
    expect(result.structuredContent?.data.weight_unit).toBe("lb");
    expect(String(fetcher.mock.calls[0]?.[0])).toContain("exercise_id=31&duration=30");
  });
});
describe("preview and write workflow", () => {
  it("previews against catalog without any POST", async () => {
    const fetcher = vi.fn<typeof fetch>(async (url, init) => apiResponse(String(url), init));
    const {call} = harness(fetcher); const preview = await call("preview_program", program);
    expect(preview.structuredContent?.data.valid).toBe(true); expect(preview.structuredContent?.data.preview_token).toEqual(expect.any(String));
    expect(fetcher.mock.calls.every(([, init]) => init?.method === "GET")).toBe(true);
  });
  it("requires confirm:true and an actual preview receipt", async () => {
    const fetcher = vi.fn<typeof fetch>(); const {call} = harness(fetcher);
    expect((await call("create_program", {...program, preview_token: "fake", confirm: false})).isError).toBe(true);
    expect((await call("create_program", {...program, preview_token: "fake", confirm: true})).isError).toBe(true);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("rejects a changed payload after preview without a POST", async () => {
    const fetcher = vi.fn<typeof fetch>(async (url, init) => apiResponse(String(url), init)); const {call} = harness(fetcher);
    const preview = await call("preview_program", program);
    const result = await call("create_program", {...program, collection: {title: "Changed"}, confirm: true, preview_token: preview.structuredContent?.data.preview_token});
    expect(result.isError).toBe(true); expect(fetcher.mock.calls.every(([, init]) => init?.method === "GET")).toBe(true);
  });
  it("creates the complete program with exact string-valued sets", async () => {
    const fetcher = vi.fn<typeof fetch>(async (url, init) => apiResponse(String(url), init)); const {call} = harness(fetcher);
    const preview = await call("preview_program", program);
    const result = await call("create_program", {...program, confirm: true, preview_token: preview.structuredContent?.data.preview_token});
    expect(result.structuredContent?.data.write_status).toBe("complete");
    const posts = fetcher.mock.calls.filter(([, init]) => init?.method === "POST"); expect(posts).toHaveLength(2);
    expect(JSON.parse(String(posts[1]?.[1]?.body))).toEqual({collectionId: 42, workout});
  });
  it("stops after partial creation and never retries failed POST", async () => {
    let templates = 0;
    const fetcher = vi.fn<typeof fetch>(async (url, init) => {
      if (String(url).endsWith("/templates") && init?.method === "POST" && ++templates === 2) return new Response("failure", {status: 500});
      return apiResponse(String(url), init);
    });
    const {call} = harness(fetcher), payload = {...program, workouts: [workout, {...workout, title: "Second"}, {...workout, title: "Third"}]};
    const preview = await call("preview_program", payload);
    const result = await call("create_program", {...payload, confirm: true, preview_token: preview.structuredContent?.data.preview_token});
    expect(result.isError).toBe(true); expect(result.structuredContent?.data).toMatchObject({write_status: "partial_or_unknown", collection: {id: 42},
      templates: [{id: 77}], failure: {outcome_unknown: true}, failed_template_index: 1, unattempted_templates: ["Third"]});
    expect(templates).toBe(2);
  });
  it.each(["exercise_id", "excercise_name", "exercise_image", "exercise_type"] as const)("rejects inaccurate catalog %s", async field => {
    const original = workout.exercises[0]!;
    const invalid = {...workout, exercises: [{...original, [field]: field === "exercise_id" ? 999 : "incorrect"}]};
    expect((await harness().call("preview_program", {...program, workouts: [invalid]})).isError).toBe(true);
  });
  it("fails closed when library and performed metadata have null types", async () => {
    const {call} = harness(async url => String(url).includes("library")
      ? Response.json({status: true, data: {results: [{...exercise, exercise_type: null}], pagination: {limit: 50, offset: 0, total: 1, hasMore: false}}})
      : Response.json({status: true, exercises: [{...exercise, exercise_type: null}], total_pages: 1}));
    expect((await call("preview_program", program)).isError).toBe(true);
  });
  it("previews and publishes a standalone template", async () => {
    const {call} = harness(), payload = {collection_id: 42, workout};
    const preview = await call("preview_workout_template", payload);
    const result = await call("create_workout_template", {...payload, confirm: true, preview_token: preview.structuredContent?.data.preview_token});
    expect(result.structuredContent?.data).toMatchObject({write_status: "complete", template: {id: 77}});
  });
});
