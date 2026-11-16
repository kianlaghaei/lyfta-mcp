// Local-only MCP handshake smoke for passwordless connector. Uses synthetic credentials.
import assert from "node:assert/strict";
const origin = process.env.NOAUTH_TEST_ORIGIN ?? "http://127.0.0.1:8789";
const slug = process.env.MCP_LINK_SLUG ?? "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const endpoint = origin + "/connect/" + slug + "/mcp";
const wrong = await fetch(origin + "/connect/" + "b".repeat(43) + "/mcp", {method:"POST",
  headers:{"Content-Type":"application/json","Accept":"application/json,text/event-stream"},
  body:JSON.stringify({jsonrpc:"2.0",id:1,method:"tools/list"})});
assert.equal(wrong.status,404,"Unknown connector URL must not allow access");
async function rpc(method,id,params) {
  const response = await fetch(endpoint,{
    method:"POST",headers:{"Content-Type":"application/json","Accept":"application/json,text/event-stream",
      "MCP-Protocol-Version":"2025-06-18"},
    body:JSON.stringify({jsonrpc:"2.0",id,method,...params?{params}: {}})
  });
  const body=await response.text();
  assert.equal(response.status,200,"No-auth endpoint HTTP "+response.status+": "+body.slice(0,200));
  const dataLine = body.split(/\r?\n/).find(x=>x.startsWith("data:"));
  const payload=JSON.parse(dataLine?dataLine.slice(5).trim():body);
  assert.ok(!payload.error,"MCP RPC error");
  return payload.result;
}
const initialization=await rpc("initialize",1,{
  protocolVersion:"2025-06-18",capabilities:{},clientInfo:{name:"noauth-smoke",version:"1"}
});
assert.ok(initialization.serverInfo,"MCP initialize missing server info");
const {tools}=await rpc("tools/list",2);
assert.equal(tools.length,12,"Expected existing 12 MCP tools");
const rejected=await rpc("tools/call",3,{name:"create_program",arguments:{confirm:false}});
assert.equal(rejected.isError,true,"Create must reject missing confirmed preview");
console.log("PASS: passwordless endpoint, wrong URL 404, initialize, 12 tools, and write-confirmation guard");
