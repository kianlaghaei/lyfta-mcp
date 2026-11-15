import assert from "node:assert/strict";
import {createHash, randomBytes} from "node:crypto";

const origin = process.env.OAUTH_TEST_ORIGIN ?? "http://127.0.0.1:8789";
const resource = (process.env.OAUTH_TEST_RESOURCE ?? origin+"/mcp");
const ownerPassword = process.env.OAUTH_OWNER_PASSWORD;
if (!ownerPassword) throw new Error("Set OAUTH_OWNER_PASSWORD in the test process environment");
const post = async (url, body, headers = {}) => fetch(url,{method:"POST",redirect:"manual",headers,body});

const metadataResponse = await fetch(origin+"/.well-known/oauth-protected-resource/mcp");
assert.equal(metadataResponse.status,200,"Missing OAuth protected-resource metadata");
const resourceMetadata = await metadataResponse.json();
assert.deepEqual(resourceMetadata.scopes_supported,["mcp:read","mcp:write"],"Both scopes must be advertised to ChatGPT");
const registration = await post(origin+"/oauth/register",JSON.stringify({
  client_name:"Lyfta local OAuth integration smoke test",
  redirect_uris:["http://127.0.0.1:34567/oauth/callback"],
  grant_types:["authorization_code","refresh_token"],
  response_types:["code"],
  token_endpoint_auth_method:"none"
}),{"Content-Type":"application/json"});
const regJson = await registration.json();
assert.equal(registration.status,201,"DCR: "+JSON.stringify(regJson));
const clientId = regJson.client_id;
const verifier = randomBytes(32).toString("base64url");
const challenge = createHash("sha256").update(verifier).digest("base64url");
const query = new URLSearchParams({
  client_id:clientId, redirect_uri:"http://127.0.0.1:34567/oauth/callback",
  response_type:"code", scope:"mcp:read mcp:write",
  code_challenge:challenge, code_challenge_method:"S256", state:"smoke-oauth",
  resource
});
const authorization = await fetch(origin+"/authorize?"+query.toString(),{redirect:"manual"});
const html = await authorization.text();
assert.equal(authorization.status,200,"Authorization GET: "+html.slice(0,250));
assert.match(html,/Lyfta MCP/);
const handle = html.match(/name="handle" value="([^"]+)"/)?.[1];
assert.ok(handle, "Missing CSRF-bound handle");
const cookies = authorization.headers.getSetCookie().map(s=>s.split(";")[0]).join("; ");
assert.ok(cookies,"Missing authorization cookies");
const form = new URLSearchParams({
  handle,decision:"approve",owner_password:ownerPassword,
});
form.append("scope","mcp:read");form.append("scope","mcp:write");
const approval = await post(origin+"/authorize",form.toString(),{
  "Content-Type":"application/x-www-form-urlencoded","Cookie":cookies
});
const app = await approval.text();
assert.equal(approval.status,302,"Authorization POST: "+app.slice(0,250));
const redirect = new URL(approval.headers.get("Location"));
assert.equal(redirect.searchParams.get("state"),"smoke-oauth");
const code = redirect.searchParams.get("code");
assert.ok(code,"Missing OAuth code");
const tokens = await post(origin+"/oauth/token",new URLSearchParams({
  grant_type:"authorization_code",code,redirect_uri:"http://127.0.0.1:34567/oauth/callback",
  client_id:clientId,code_verifier:verifier,resource
}).toString(),{"Content-Type":"application/x-www-form-urlencoded"});
const tokenJson = await tokens.json();
assert.equal(tokens.status,200,"Token exchange: "+JSON.stringify({error:tokenJson.error,description:tokenJson.error_description}));
assert.ok(tokenJson.access_token,"Missing OAuth access token");
const bad = await fetch(origin+"/mcp",{method:"POST",headers:{"Authorization":"Bearer wrong","Content-Type":"application/json"},body:'{"jsonrpc":"2.0","id":1,"method":"tools/list"}'});
assert.equal(bad.status,401);
const good = await fetch(origin+"/mcp",{method:"POST",headers:{"Authorization":"Bearer "+tokenJson.access_token,"Content-Type":"application/json","Accept":"application/json,text/event-stream"},body:'{"jsonrpc":"2.0","id":1,"method":"tools/list"}'});
assert.equal(good.status,200,"Valid OAuth token must reach working upstream MCP");
const raw = await good.text();
const dataLine = raw.split(/\r?\n/).find(line => line.startsWith("data:"));
const toolList = JSON.parse(dataLine ? dataLine.slice(5).trim() : raw);
assert.ok(Array.isArray(toolList.result?.tools),"Missing MCP tool list: "+raw.slice(0,250));
assert.equal(toolList.result.tools.length,12,"Expected 12 Lyfta MCP tools");
console.log("PASS: DCR, PKCE S256, owner consent, token exchange, invalid-token rejection, and all 12 upstream tools.");
