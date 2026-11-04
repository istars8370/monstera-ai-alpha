import test from "node:test";
import assert from "node:assert/strict";
import {OpenAIAdapter} from "../lib/providers/openai.ts";
import {outputTokenLimit} from "../lib/providers/limits.ts";

test("provider max tokens are bounded by explicit server policy",()=>{
 assert.equal(outputTokenLimit(undefined,{MONSTERA_MAX_OUTPUT_TOKENS:"250"}),250);
 assert.equal(outputTokenLimit(140,{MONSTERA_MAX_OUTPUT_TOKENS:"250"}),140);
 for(const value of [0,-1,251,1.5,Number.MAX_SAFE_INTEGER]){
   assert.throws(()=>outputTokenLimit(value,{MONSTERA_MAX_OUTPUT_TOKENS:"250"}));
 }
 for(const cap of ["0","-1","999999","garbage","12.5"]){
   assert.throws(()=>outputTokenLimit(1,{MONSTERA_MAX_OUTPUT_TOKENS:cap}));
 }
});
test("OpenAI adapter sends only mocked request, reuses bounded SSE parser",async()=>{
 const old=process.env.MONSTERA_MAX_OUTPUT_TOKENS;
 process.env.MONSTERA_MAX_OUTPUT_TOKENS="256";
 const calls=[];
 const fakeFetch=async (url,init)=>{
   calls.push({url,init});
   assert.equal(url,"https://api.openai.com/v1/chat/completions");
   assert.equal(init.headers.Authorization,"Bearer mock-not-real");
   const body=JSON.parse(init.body);
   assert.equal(body.model,"mock-model-id");
   assert.equal(body.max_tokens,128);
   assert.equal(body.stream_options.include_usage,true);
   return new Response('data: {"choices":[{"delta":{"content":"한글"}}]}\n\ndata: {"usage":{"prompt_tokens":7,"completion_tokens":2}}\n\ndata: [DONE]\n\n',
     {status:200,headers:{"content-type":"text/event-stream"}});
 };
 try {
   const adapter=new OpenAIAdapter("mock-not-real",fakeFetch);
   const chunks=[];
   for await(const part of adapter.chatStream({model:"mock-model-id",messages:[{role:"user",content:"test"}],maxTokens:128})){
     chunks.push(part);
   }
   assert.deepEqual(chunks,[{type:"delta",text:"한글"},{type:"usage",usage:{inputTokens:7,outputTokens:2}},{type:"done"}]);
   assert.equal(calls.length,1);
 } finally {
   if(old===undefined)delete process.env.MONSTERA_MAX_OUTPUT_TOKENS;
   else process.env.MONSTERA_MAX_OUTPUT_TOKENS=old;
 }
});
test("OpenAI adapter rejects truncated provider streams",async()=>{
 const adapter=new OpenAIAdapter("mock-not-real",async()=>new Response('data: {"choices":[{"delta":{"content":"partial"}}]}\n\n',{status:200}));
 await assert.rejects(async()=>{for await(const _ of adapter.chatStream({model:"mock",messages:[]})){}},/UPSTREAM_TRUNCATED_SSE/);
});
