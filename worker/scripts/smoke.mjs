/** Local smoke test: no real Lyfta calls or writes. */
import assert from "node:assert/strict";

const base = process.env.MCP_URL ?? "http://127.0.0.1:8787";
const token = process.env.MCP_ACCESS_TOKEN;
if (!token) throw new Error("MCP_ACCESS_TOKEN must be provided via environment");
const health = await fetch(base + "/healthz");
assert.equal(health.status, 200);
const unauthorized = await fetch(base + "/mcp", {
  method: "POST",
  headers: {"Content-Type":"application/json", "Accept":"application/json, text/event-stream"},
  body: JSON.stringify({jsonrpc:"2.0", id:1, method:"tools/list"})
});
assert.equal(unauthorized.status, 401);

async function rpc(id, method, params, protocol = "2025-06-18") {
  const response = await fetch(base + "/mcp", {
    method:"POST",
    headers: {
      Authorization:"Bearer " + token,
      "Content-Type":"application/json",
      "Accept":"application/json, text/event-stream",
      "MCP-Protocol-Version":protocol,
      ...(protocol === "2026-07-28" ? {"Mcp-Method":method} : {})
    },
    body: JSON.stringify({jsonrpc:"2.0",id,method, ...(params ? {params} : {})})
  });
  const body = await response.text();
  assert.equal(response.status, 200, "Unexpected MCP status " + response.status + ": " + body.substring(0,500));
  const message = body.includes("data:")
    ? JSON.parse(body.split("\n").find(line => line.startsWith("data:"))?.slice(5) ?? "{}")
    : JSON.parse(body);
  assert.ok(!message.error, JSON.stringify(message.error));
  return message.result;
}
const init = await rpc(1, "initialize", {
  protocolVersion:"2025-06-18",
  capabilities:{},
  clientInfo:{name:"smoke-test", version:"0.1"}
});
assert.ok(init.serverInfo, "Missing MCP server info");
const tools = await rpc(2, "tools/list");
const names = tools.tools.map(t=>t.name);
assert.ok(names.includes("search_exercises"));
assert.ok(names.includes("create_program"));
assert.equal(names.length, 12);
for (const tool of tools.tools) assert.ok(tool.outputSchema, "Missing output schema for " + tool.name);
const invalidWrite = await rpc(3, "tools/call", {name:"create_program", arguments:{confirm:false}});
assert.equal(invalidWrite.isError, true);
const modern = await rpc(4, "tools/list", {_meta: {
  "io.modelcontextprotocol/protocolVersion":"2026-07-28",
  "io.modelcontextprotocol/clientCapabilities":{},
  "io.modelcontextprotocol/clientInfo":{name:"smoke-test",version:"0.2"}
}}, "2026-07-28");
assert.equal(modern.tools.length, 12);
console.log("PASS: health, unauthorized access, legacy initialize, tools/list (" + names.length + " tools), invalid write refused, modern tools/list");
