import {env as runtimeEnv} from "cloudflare:workers";
import OAuthProvider, {
  insufficientScope,
  AuthorizationError,
  type OAuthHelpers
} from "@cloudflare/workers-oauth-provider";

// Generated Wrangler types describe OAUTH_ORIGIN and other bindings.
const HOST = runtimeEnv.OAUTH_ORIGIN;
const RESOURCE = HOST + "/mcp";

interface Env {
  OAUTH_ORIGIN: string;
  OAUTH_KV: KVNamespace;
  LYFTA_WORKER: Fetcher;
  OAUTH_OWNER_PASSWORD: string;
  MCP_ACCESS_TOKEN: string;
  OAUTH_PROVIDER: OAuthHelpers;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, char => "&#" + char.charCodeAt(0) + ";");
}

async function isOwner(provided: string, expected: string): Promise<boolean> {
  if (!expected || expected.length < 16 || !provided || provided.length > 512) return false;
  const enc = new TextEncoder();
  const [a, b] = await Promise.all([
    crypto.subtle.digest("SHA-256", enc.encode(provided)),
    crypto.subtle.digest("SHA-256", enc.encode(expected))
  ]);
  const left = new Uint8Array(a), right = new Uint8Array(b);
  let diff = 0;
  for (let i = 0; i < left.length; i++) diff |= left[i]! ^ right[i]!;
  return diff === 0;
}

function htmlPage(details: {clientName: string; clientDomain?: string | null; redirectHost: string; redirectIsLoopback: boolean; scope: string[]}, handle: string): string {
  const name = escapeHtml(details.clientName);
  const source = details.clientDomain ? "Verified client domain: " + escapeHtml(details.clientDomain) : "The application name is not independently verified.";
  const scopes = details.scope.map(s => `<li>${escapeHtml(s)}<input type="hidden" name="scope" value="${escapeHtml(s)}"></li>`).join("");
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Authorize Lyfta MCP</title>
<style>body{font:16px system-ui;max-width:550px;margin:8vh auto;padding:20px;line-height:1.6}input{width:100%;padding:12px;box-sizing:border-box}button{padding:10px 18px;margin:10px 6px 0 0}small{color:#555}</style>
<h1>Connect to Lyfta MCP</h1><p><strong>${name}</strong> requests access to your private fitness tools.</p>
<p><small>${source}</small></p>
<p>Token destination: <strong>${escapeHtml(details.redirectHost)}</strong></p>
${details.redirectIsLoopback ? "<p><strong>Warning: this redirects to an app on your own computer.</strong></p>" : ""}
<p>Scopes requested:</p><ul>${scopes}</ul>
<form method="post" autocomplete="off">
<input type="hidden" name="handle" value="${escapeHtml(handle)}">
<label for="pass">Password (رمز ورود)</label><input id="pass" type="password" name="owner_password" required minlength="16" autocomplete="current-password" placeholder="Enter your personal password"><p><small>Paste the password saved on your computer; no long access phrase is needed.</small></p>
<button type="submit" name="decision" value="approve">Authorize</button>
<button type="submit" name="decision" value="deny" formnovalidate>Deny</button>
</form><p><small>Only approve a connection that you initiated yourself.</small></p></html>`;
}

const defaultHandler = {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/healthz") return Response.json({ok: true, service: "lyfta-oauth-gateway"});
    if (url.pathname === "/.well-known/oauth-protected-resource/mcp" || url.pathname === "/.well-known/oauth-protected-resource")
      return Response.json({resource: RESOURCE, authorization_servers: [HOST], scopes_supported: ["mcp:read", "mcp:write"]},
        {headers: {"Cache-Control": "public, max-age=300"}});
    if (url.pathname !== "/authorize") return new Response("Not found", {status:404});
    if (!env.OAUTH_OWNER_PASSWORD || env.OAUTH_OWNER_PASSWORD.length < 16 || !env.MCP_ACCESS_TOKEN)
      return new Response("Owner authorization is not configured", {status:503});
    const oauth = env.OAUTH_PROVIDER;
    try {
      if (request.method === "GET") {
        const authRequest = await oauth.parseAuthRequest(request);
        const description = await oauth.describeConsent(authRequest);
        const {handle, headers} = await oauth.beginConsent(authRequest);
        headers.set("Content-Type", "text/html; charset=utf-8");
        headers.set("Cache-Control", "no-store");
        headers.set("X-Frame-Options", "DENY");
        headers.set("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'");
        return new Response(htmlPage(description, handle), {headers});
      }
      if (request.method !== "POST") return new Response("Method not allowed", {status:405});
      if (Number(request.headers.get("Content-Length") ?? 0) > 4096) return new Response("Request too large", {status:413});
      const form = await request.formData();
      const handle = form.get("handle");
      if (typeof handle !== "string" || handle.length > 512) return new Response("Invalid authorization", {status:400});
      if (form.get("decision") === "deny") {
        const denial = await oauth.denyConsent(request, handle);
        return new Response(null, {status:302, headers:denial.headers});
      }
      if (form.get("decision") !== "approve" || !(await isOwner(String(form.get("owner_password") ?? ""),env.OAUTH_OWNER_PASSWORD)))
        return new Response("Invalid authorization", {status:403});
      const approval = await oauth.approveConsent(request,handle,{scope:form.getAll("scope").map(String)});
      const {redirectTo} = await oauth.completeAuthorization({
        request:approval.request,
        userId:"lyfta-owner",
        metadata:{label:"Lyfta personal owner"},
        scope:approval.request.scope.filter(s=>["mcp:read","mcp:write","offline_access"].includes(s)),
        props:{owner:true}
      });
      approval.headers.set("Location",redirectTo);
      approval.headers.set("Cache-Control","no-store");
      return new Response(null,{status:302,headers:approval.headers});
    } catch(error) {
      if (error instanceof AuthorizationError) {
        if (error.redirectTo) return Response.redirect(error.redirectTo,302);
        return new Response("Invalid OAuth authorization request", {status:400});
      }
      return new Response("Authorization failed", {status:400});
    }
  }
};

const apiHandler = {
  async fetch(request: Request,env: Env,ctx: ExecutionContext & {auth?: {scope:string[]}}): Promise<Response> {
    if (!env.MCP_ACCESS_TOKEN || env.MCP_ACCESS_TOKEN.length < 32) return new Response("Gateway not configured",{status:503});
    if (!ctx.auth?.scope.includes("mcp:read")) return insufficientScope(ctx.auth as never,["mcp:read"]);
    // MCP tool calls use JSON-RPC POST. Enforce write scope for write tools (not merely descriptions).
    if (request.method === "POST") {
      if (Number(request.headers.get("Content-Length") ?? 0) > 512_000)
        return new Response("Request too large",{status:413});
      let payload: unknown;
      try {payload = await request.clone().json();}
      catch {return new Response("Invalid MCP JSON",{status:400});}
      const isWrite = (value: unknown): boolean => {
        if (!value || typeof value !== "object") return false;
        const call = value as {method?: unknown;params?: {name?: unknown}};
        return call.method === "tools/call" &&
          (call.params?.name === "create_program" || call.params?.name === "create_workout_template");
      };
      const calls = Array.isArray(payload) ? payload : [payload];
      if (calls.some(isWrite) && !ctx.auth.scope.includes("mcp:write"))
        return insufficientScope(ctx.auth as never,["mcp:read","mcp:write"]);
    }
    // The upstream MCP server is reached through Cloudflare internal Service Binding.
    // Do not forward client-provided authorization headers or Origin.
    const headers = new Headers(request.headers);
    headers.delete("Origin");
    headers.delete("Cookie");
    headers.set("Authorization","Bearer "+env.MCP_ACCESS_TOKEN);
    const upstream = new Request("https://lyfta-personal-mcp.internal/mcp",{
      method:request.method,headers,body:request.method==="GET"||request.method==="HEAD"?undefined:request.body,
      redirect:"manual"
    });
    return env.LYFTA_WORKER.fetch(upstream);
  }
};

const oauthProvider = new OAuthProvider<Env>({
  apiRoute:"/mcp",
  apiHandler,
  defaultHandler,
  authorizeEndpoint:"/authorize",
  tokenEndpoint:"/oauth/token",
  clientRegistrationEndpoint:"/oauth/register",
  clientIdMetadataDocumentEnabled:true,
  scopesSupported:["mcp:read","mcp:write","offline_access"],
  // Both scopes are required initially: ChatGPT must be offered program creation, not read-only access.
  requiredScopes:["mcp:read","mcp:write"],
  resourceMetadata:{resource:RESOURCE,authorization_servers:[HOST]}
});

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const pathname = new URL(request.url).pathname;
    const isMetadata = pathname.startsWith("/.well-known/") || pathname === "/healthz";
    if (!isMetadata && (!env.OAUTH_OWNER_PASSWORD || env.OAUTH_OWNER_PASSWORD.length < 16
       || !env.MCP_ACCESS_TOKEN || env.MCP_ACCESS_TOKEN.length < 32
       || env.OAUTH_OWNER_PASSWORD === env.MCP_ACCESS_TOKEN))
      return new Response("OAuth Gateway is not provisioned", {status:503});
    const response = await oauthProvider.fetch(request, env, ctx);
    if (new URL(request.url).pathname === "/mcp" && response.status === 401) {
      const headers = new Headers(response.headers);
      headers.set("WWW-Authenticate",
        'Bearer realm="OAuth", resource_metadata="' +
        HOST + '/.well-known/oauth-protected-resource/mcp", scope="mcp:read mcp:write"');
      return new Response(response.body, {status: 401, headers});
    }
    return response;
  }
} satisfies ExportedHandler<Env>;
