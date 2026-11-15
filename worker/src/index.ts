import { createMcpHandler } from "@modelcontextprotocol/server";
import { LyftaClient } from "./lyfta-client.js";
import { createServer } from "./server.js";

interface Env {
  LYFTA_API_KEY: string;
  MCP_ACCESS_TOKEN: string;
}

/** Fixed-length digest comparison to avoid exposing token comparison timing. */
async function bearerIsValid(request: Request, expected: string): Promise<boolean> {
  const supplied = /^Bearer\s+(.+)$/i.exec(request.headers.get("Authorization") ?? "")?.[1] ?? "";
  if (!supplied || !expected) return false;
  const enc = new TextEncoder();
  const [a, b] = await Promise.all([
    crypto.subtle.digest("SHA-256", enc.encode(supplied)),
    crypto.subtle.digest("SHA-256", enc.encode(expected))
  ]);
  const left = new Uint8Array(a), right = new Uint8Array(b);
  let diff = 0;
  for (let i = 0; i < left.length; i++) diff |= left[i]! ^ right[i]!;
  return diff === 0;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const pathname = new URL(request.url).pathname;
    if (pathname === "/healthz") return Response.json({ok: true, service: "lyfta-personal-mcp"});
    if (pathname !== "/mcp") return new Response("Not found", {status: 404});
    if (!env.LYFTA_API_KEY?.trim() || !env.MCP_ACCESS_TOKEN?.trim() || env.MCP_ACCESS_TOKEN.length < 32
      || env.LYFTA_API_KEY === env.MCP_ACCESS_TOKEN)
      return Response.json({error: "Worker secrets missing"}, {status: 503});
    if (!(await bearerIsValid(request, env.MCP_ACCESS_TOKEN)))
      return new Response("Unauthorized", {status: 401, headers: {"WWW-Authenticate": "Bearer"}});
    // MCP SDK creates stateless HTTP transport. No Durable Objects or database needed.
    const client = new LyftaClient(env.LYFTA_API_KEY);
    const origin = request.headers.get("Origin");
    if (origin && origin !== new URL(request.url).origin)
      return Response.json({error: "Cross-origin browser requests are not allowed"}, {status: 403});
    const handler = createMcpHandler(() => createServer(client, env.MCP_ACCESS_TOKEN),
      {legacy: "stateless", responseMode: "json", maxRequestBodySize: 512_000, maxSubscriptions: 0});
    try {return await handler.fetch(request);}
    catch {return Response.json({error: "MCP request could not complete"}, {status: 500});}
  }
} satisfies ExportedHandler<Env>;
