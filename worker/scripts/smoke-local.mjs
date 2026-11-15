/** Real workerd transport test using synthetic credentials; no Lyfta API calls. */
import {spawn} from "node:child_process";
import {setTimeout as delay} from "node:timers/promises";
const port = process.env.SMOKE_PORT ?? "8788";
const token = "synthetic-local-smoke-token-at-least-32-bytes";
const base = "http://127.0.0.1:" + port;
const child = spawn(process.execPath, ["node_modules/wrangler/bin/wrangler.js", "dev", "--local", "--ip", "127.0.0.1",
  "--port", port, "--var", "LYFTA_API_KEY:synthetic-no-live-api", "--var", "MCP_ACCESS_TOKEN:" + token],
  {stdio: ["ignore", "pipe", "pipe"], windowsHide: true, env: {...process.env, WRANGLER_SEND_METRICS: "false"}});
let logs = "";
child.stdout.on("data", data => {logs = (logs + data).slice(-5000);});
child.stderr.on("data", data => {logs = (logs + data).slice(-5000);});
try {
  let ready = false;
  for (let attempt = 0; attempt < 80; attempt++) {
    if (child.exitCode !== null) throw new Error("Local Worker exited before readiness");
    try {ready = (await fetch(base + "/healthz", {signal: AbortSignal.timeout(500)})).ok;} catch {}
    if (ready) break;
    await delay(250);
  }
  if (!ready) throw new Error("Local Worker did not become ready");
  const smoke = spawn(process.execPath, ["scripts/smoke.mjs"], {stdio: "inherit", windowsHide: true,
    env: {...process.env, MCP_URL: base, MCP_ACCESS_TOKEN: token}});
  const code = await new Promise((resolve, reject) => {smoke.on("exit", resolve); smoke.on("error", reject);});
  if (code !== 0) throw new Error("Smoke assertions failed");
} catch (error) {
  console.error(String(error)); console.error(logs); process.exitCode = 1;
} finally {
  child.kill("SIGTERM");
  await Promise.race([new Promise(resolve => child.once("exit", resolve)), delay(2000)]);
}
