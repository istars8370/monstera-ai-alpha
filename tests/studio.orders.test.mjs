import test,{beforeEach} from "node:test";
import assert from "node:assert/strict";
import {NextRequest} from "next/server.js";
import {createSessionToken} from "../lib/session-token.ts";
import {GET as list,POST as create} from "../app/api/studio/orders/route.ts";
import {GET as get,PATCH as update} from "../app/api/studio/orders/[id]/route.ts";
import {addUser,resetTestDb} from "./mocks/db-pool.mjs";

const origin="http://localhost:3000",secret="mock-order-only-session-secret-over-thirty-two-bytes";
const owner="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",other="bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const sample={service:"콘텐츠 제작",price_krw:300000,paid_krw:300000,cash_cost_krw:80000,
 labor_minutes:300,labor_rate_krw:30000,fee_krw:10000,revisions:1,refund_krw:0,
 external_customer_flag:false,rights_checked:false,delivery_accepted:false,
 conflict_declared:false,consent_recorded:false};
beforeEach(()=>{
 resetTestDb();process.env.MONSTERA_PUBLIC_ORIGIN=origin;process.env.MONSTERA_SESSION_SECRET=secret;
 addUser({id:owner,email:"owner@example.invalid",google_sub:"owner",tier:"studio",session_epoch:0,email_verified_at:new Date()});
 addUser({id:other,email:"other@example.invalid",google_sub:"other",tier:"free",session_epoch:0,email_verified_at:new Date()});
});
const cookie=id=>"monstera_session="+createSessionToken(id,0,secret);
function request(path,method="GET",body=undefined,id=owner,requestOrigin=origin){
 return new NextRequest(origin+path,{method,headers:{
  ...(id?{cookie:cookie(id)}:{}),...(method==="GET"?{}:{origin:requestOrigin,"content-type":"application/json"})},
  ...(body===undefined?{}:{body:JSON.stringify(body)})});
}
const ctx=id=>({params:Promise.resolve({id})});
test("orders are denied to anonymous and non-studio tier",async()=>{
 assert.equal((await list(request("/api/studio/orders","GET",undefined,null))).status,401);
 assert.equal((await create(request("/api/studio/orders","POST",sample,other))).status,403);
 assert.equal((await list(request("/api/studio/orders","GET",undefined,other))).status,403);
});
test("orders separate KRW business amounts and owner access",async()=>{
 const response=await create(request("/api/studio/orders","POST",
   {...sample,userId:other,labor_cost_krw:0,contribution_krw:999999}));
 assert.equal(response.status,201);
 const data=(await response.json()).order;
 assert.equal(data.user_id,owner);
 assert.equal(data.labor_cost_krw,150000);
 assert.equal(data.contribution_krw,60000);
 assert.equal((await list(request("/api/studio/orders"))).status,200);
 const foreignGet=await get(request("/api/studio/orders/"+data.order_id,"GET",undefined,other),ctx(data.order_id));
 assert.equal(foreignGet.status,403);
});
test("orders use server CAS; stale revision cannot overwrite",async()=>{
 const created=await create(request("/api/studio/orders","POST",sample));
 const data=(await created.json()).order;
 const path="/api/studio/orders/"+data.order_id;
 const first=await update(request(path,"PATCH",{revision:1,order:{...sample,paid_krw:200000}}),ctx(data.order_id));
 assert.equal(first.status,200);
 assert.equal((await first.json()).order.contribution_krw,-40000);
 const second=await update(request(path,"PATCH",{revision:1,order:sample}),ctx(data.order_id));
 assert.equal(second.status,409);
});
test("orders reject invalid business numbers and cross-origin writes",async()=>{
 for(const values of [{paid_krw:300001},{refund_krw:300001},{paid_krw:0.5},
   {labor_minutes:-1},{service:""},{rights_checked:"true"},{price_krw:null}]) {
   const response=await create(request("/api/studio/orders","POST",{...sample,...values}));
   assert.equal(response.status,400);
 }
 assert.equal((await create(request("/api/studio/orders","POST",sample,owner,"https://evil.example"))).status,403);
});
