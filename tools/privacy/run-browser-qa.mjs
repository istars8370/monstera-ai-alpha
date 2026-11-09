import { spawn } from "node:child_process";
import { once } from "node:events";
let logs = "";
const server = spawn(process.execPath, ["tools/privacy/demo.mjs", "--production"], { stdio: ["ignore", "pipe", "pipe"] });
server.stdout.on("data", chunk => { logs += chunk; });
server.stderr.on("data", chunk => { logs += chunk; });
let code = 1;
try {
  let ready = false;
  for (let i = 0; i < 300; i++) {
    if (server.exitCode !== null) throw new Error("DEMO_EXITED");
    try { const response = await fetch("http://127.0.0.1:3000/api/health", { signal: AbortSignal.timeout(500) }); if (response.ok) { ready = true; break; } } catch { /* waiting for local server */ }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  if (!ready) throw new Error("DEMO_START_TIMEOUT");
  const qa = spawn(process.execPath, ["tools/privacy/browser-qa.mjs"], { stdio: "inherit" });
  code = (await once(qa, "exit"))[0] ?? 1;
  if (/FICTIONAL_BROWSER_PROMPT|FICTIONAL_NETWORK_FAILURE|FICTIONAL_CANCEL|FICTIONAL_REFRESH|offline-dummy-key/.test(logs)) throw new Error("PRIVATE_DATA_IN_DEMO_LOGS");
} catch (error) {
  console.error(error instanceof Error ? error.message : "BROWSER_QA_FAILED"); code = 1;
} finally {
  server.kill("SIGTERM");
  await Promise.race([once(server, "exit"), new Promise(resolve => setTimeout(resolve, 3000))]);
}
process.exitCode = code;
