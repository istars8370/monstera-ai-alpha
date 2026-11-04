import type { ChatRequest, Chunk, HealthStatus, ModelInfo, ProviderAdapter } from "@/lib/providers/types";
import { outputTokenLimit } from "@/lib/providers/limits";

export type MockScenario="success"|"error"|"empty"|"truncated"|"aborted"|"timeout"|"slow";

/** Strictly deterministic, zero-I/O fake. This adapter never delegates to fetch(). */
export class StudioMockProvider implements ProviderAdapter {
  constructor(private readonly scenario:MockScenario="success") {}
  async *chatStream(req:ChatRequest):AsyncIterable<Chunk> {
    const cap=outputTokenLimit(req.maxTokens);
    const prompt=req.messages.filter(x=>x.role==="user").at(-1)?.content??"";
    if(!prompt.trim())throw new Error("MOCK_EMPTY_PROMPT");
    if(this.scenario==="error")throw new Error("MOCK_PROVIDER_FAILURE");
    if(this.scenario==="empty")return;
    if(this.scenario==="aborted")throw new Error("UPSTREAM_ABORTED");
    if(this.scenario==="timeout") {
      await new Promise<void>((_,reject)=>{
        if(req.signal?.aborted){reject(new Error("UPSTREAM_ABORTED"));return;}
        req.signal?.addEventListener("abort",()=>reject(new Error("UPSTREAM_ABORTED")),{once:true});
      });
      return;
    }
    if(this.scenario==="slow")await Promise.resolve();
    if(req.signal?.aborted)throw new Error("UPSTREAM_ABORTED");
    const text=("[MOCK ONLY · AI가 생성한 실제 결과가 아닙니다]\n"+
      "수동 검수를 위한 시험 문장입니다.\n"+prompt.trim().slice(0,Math.min(1000,cap*2)))
      .slice(0,15000);
    const inputTokens=Math.max(1,Math.ceil(Buffer.byteLength(prompt,"utf8")/4));
    const outputTokens=Math.min(cap,Math.max(1,Math.ceil(Buffer.byteLength(text,"utf8")/4)));
    yield {type:"delta",text};
    if(this.scenario==="truncated")return;
    if(req.signal?.aborted)throw new Error("UPSTREAM_ABORTED");
    yield {type:"usage",usage:{inputTokens,outputTokens}};
    yield {type:"done"};
  }
  async listModels():Promise<readonly ModelInfo[]> {return [{id:"mock-only",name:"Studio mock adapter"}];}
  async healthCheck():Promise<HealthStatus>{return {healthy:true,latencyMs:0};}
}
