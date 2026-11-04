// Explicit one-shot tick, never run by HTTP handlers, timers or deployment.
// A separate scheduler/supervisor is required for real durable operation.
import { requireMockStudio } from "../lib/studio/mock-gate.ts";
import { runMockWorkerTick } from "../lib/studio/mock-worker.ts";
import { getPool } from "../db/pool.ts";

requireMockStudio();
try {
  const result=await runMockWorkerTick();
  // Do not print prompts, results, credentials, sessions, or private customer data.
  console.info(JSON.stringify({mockOnly:true,recovered:result.recovered,reclaimed:result.reclaimed,
    jobStatus:result.result?.status??"none",jobProcessed:result.result!==null}));
}finally{
  await getPool().end();
}
