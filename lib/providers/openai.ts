import type {ChatRequest,Chunk,HealthStatus,ModelInfo,ProviderAdapter} from "@/lib/providers/types";
import {parseSse} from "@/lib/providers/openrouter";
import {outputTokenLimit} from "@/lib/providers/limits";

export class OpenAIAdapter implements ProviderAdapter {
  constructor(private readonly apiKey:string, private readonly fetcher:typeof fetch=fetch) {
    if(!apiKey)throw new Error("OPENAI_API_KEY_NOT_CONFIGURED");
  }
  async *chatStream(req:ChatRequest):AsyncIterable<Chunk> {
    const maxTokens=outputTokenLimit(req.maxTokens);
    const response=await this.fetcher("https://api.openai.com/v1/chat/completions",{
      method:"POST",
      headers:{Authorization:`Bearer ${this.apiKey}`,"Content-Type":"application/json"},
      body:JSON.stringify({
        model:req.model,messages:req.messages,stream:true,max_tokens:maxTokens,
        stream_options:{include_usage:true},
      }),
      signal:req.signal,
    });
    yield* parseSse(response,req.signal);
  }
  async listModels():Promise<readonly ModelInfo[]> {
    const response=await this.fetcher("https://api.openai.com/v1/models",{
      headers:{Authorization:`Bearer ${this.apiKey}`},
    });
    if(!response.ok)throw new Error("OPENAI_MODELS_UNAVAILABLE");
    const data:unknown=await response.json();
    if(!data||typeof data!=="object"||!("data" in data)||!Array.isArray(data.data))
      throw new Error("INVALID_MODEL_LIST");
    return data.data.flatMap((entry:unknown)=>{
      if(!entry||typeof entry!=="object"||!("id" in entry)||typeof entry.id!=="string")return [];
      return [{id:entry.id,name:entry.id}];
    });
  }
  async healthCheck():Promise<HealthStatus> {
    const start=Date.now();
    try{await this.listModels();return {healthy:true,latencyMs:Date.now()-start};}
    catch{return {healthy:false,latencyMs:Date.now()-start};}
  }
}
