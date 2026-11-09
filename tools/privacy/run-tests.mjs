import { spawnSync } from "node:child_process";
import { rmSync } from "node:fs";
const out = ".privacy-test-build";
let code = 1;
try {
  const compile = spawnSync(process.execPath, ["node_modules/typescript/bin/tsc", "--module", "commonjs", "--moduleResolution", "node", "--target", "es2022", "--lib", "es2023,dom,dom.iterable", "--esModuleInterop", "--strict", "--skipLibCheck", "--rootDir", ".", "--outDir", out, "lib/chat-handler.ts", "lib/chat-context.ts", "lib/client-sse.ts", "middleware.ts"], { stdio: "inherit" });
  if (compile.status === 0) code = spawnSync(process.execPath, ["--test", "tests/privacy.test.mjs"], { stdio: "inherit" }).status ?? 1;
} finally { rmSync(out, { recursive: true, force: true }); }
process.exitCode = code;
