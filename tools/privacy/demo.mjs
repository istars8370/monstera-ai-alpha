import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
console.log("MONSTERA offline demo: http://127.0.0.1:3000 — login demo / demo-local-only. Fixed Mock replies; no paid API calls.");
const child = spawn(process.execPath, ["--require", resolve("tools/privacy/mock-upstream.cjs"), require.resolve("next/dist/bin/next"), process.argv.includes("--production") ? "start" : "dev", "--hostname", "127.0.0.1", "--port", "3000"], {
  stdio: "inherit",
  env: { ...process.env, NEXT_TELEMETRY_DISABLED: "1", ALPHA_BASIC_USER: "demo", ALPHA_BASIC_PASSWORD: "demo-local-only", ALPHA_CHAT_PROVIDER: "venice", ALPHA_APP_ORIGIN: "http://127.0.0.1:3000", VENICE_API_KEY: "offline-dummy-key", VENICE_PRIVATE_MODEL_ID: "demo-private", VENICE_PRIVATE_MODEL_IDS: "demo-private,demo-private-2", OPENROUTER_API_KEY: "", ALPHA_MODEL_ID: "" },
});
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => child.kill(signal));
child.on("exit", code => { process.exitCode = code ?? 0; });
