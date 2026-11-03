import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server.js";
import { createSessionToken } from "../lib/session-token.ts";
import { GET as list, POST as create } from "../app/api/studio/drafts/route.ts";
import { GET as get, PATCH as update } from "../app/api/studio/drafts/[id]/route.ts";
import { POST as exportDraft } from "../app/api/studio/drafts/[id]/export/route.ts";
import { addUser, resetTestDb } from "./mocks/db-pool.mjs";

const origin = "http://localhost:3000";
const secret = "studio-drafts-test-secret-longer-than-thirty-two-bytes";
const userA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const userB = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const brief = { brand:"검수 브랜드",industry:"서비스",purpose:"신규 서비스 소개",audience:"고객",
  channel:"naver-blog",length:"short" };
beforeEach(() => {
  resetTestDb();
  process.env.MONSTERA_PUBLIC_ORIGIN = origin;
  process.env.MONSTERA_SESSION_SECRET = secret;
  for (const [id,email] of [[userA,"a@example.invalid"],[userB,"b@example.invalid"]]) {
    addUser({id,email,google_sub:"google-"+id,tier:"free",session_epoch:0,email_verified_at:new Date()});
  }
});
function cookie(id) {return "monstera_session="+createSessionToken(id,0,secret);}
function request(path,method="GET",body=undefined,id=userA,requestOrigin=origin) {
  return new NextRequest(origin+path,{
    method, headers:{ ...(id?{cookie:cookie(id)}:{}),
      ...(method==="GET"?{}:{origin:requestOrigin,"content-type":"application/json"}) },
    ...(body===undefined?{}:{body:JSON.stringify(body)}),
  });
}
const ctx=(id)=>({params:Promise.resolve({id})});
async function createOne(id=userA) {
  const response=await create(request("/api/studio/drafts","POST",
    {brief, userId:userB, tier:"studio"},id));
  assert.equal(response.status,201);
  return (await response.json()).draft;
}
test("drafts require a verified user session",async()=>{
  assert.equal((await list(request("/api/studio/drafts","GET",undefined,null))).status,401);
  assert.equal((await create(request("/api/studio/drafts","POST",{brief},null))).status,401);
});
test("drafts are owner-scoped; forged body userId is ignored",async()=>{
  const draft=await createOne();
  assert.equal(draft.userId,userA);
  const listed=await list(request("/api/studio/drafts"));
  assert.equal((await listed.json()).drafts.length,1);
  const foreign=await get(request("/api/studio/drafts/"+draft.id,"GET",undefined,userB),ctx(draft.id));
  assert.equal(foreign.status,404);
  const foreignPatch=await update(request("/api/studio/drafts/"+draft.id,"PATCH",
    {action:"review",revision:1},userB),ctx(draft.id));
  assert.equal(foreignPatch.status,404);
});
test("revision CAS rejects stale updates, edits invalidate approvals and export requires review",async()=>{
  const draft=await createOne();
  const path="/api/studio/drafts/"+draft.id;
  const early=await exportDraft(request(path+"/export","POST",{revision:1}),ctx(draft.id));
  assert.equal(early.status,409);
  const reviewed=await update(request(path,"PATCH",{action:"review",revision:1}),ctx(draft.id));
  assert.equal(reviewed.status,200);
  assert.equal((await reviewed.json()).draft.revision,2);
  const stale=await update(request(path,"PATCH",{action:"review",revision:1}),ctx(draft.id));
  assert.equal(stale.status,409);
  const checks={edited:true,rights:true,facts:true,commercial:true,likeness:true,owner:"forged"};
  const approved=await update(request(path,"PATCH",{action:"approve",revision:2,checks}),ctx(draft.id));
  assert.equal(approved.status,200);
  assert.equal(Object.hasOwn((await approved.json()).draft.checks,"owner"),false);
  const exported=await exportDraft(request(path+"/export","POST",{revision:3}),ctx(draft.id));
  assert.equal(exported.status,200);
  assert.match((await exported.json()).markdown,/승인된 콘텐츠/);
  const version=await get(request(path),ctx(draft.id));
  const snapshot=(await version.json()).draft;
  assert.equal(snapshot.revision,4);
  const edited=await update(request(path,"PATCH",{action:"edit",revision:4,
    content:{...snapshot.content,post:"사람이 수정한 내용"}}),ctx(draft.id));
  assert.equal(edited.status,200);
  assert.equal((await edited.json()).draft.state,"DRAFT");
  assert.equal((await exportDraft(request(path+"/export","POST",{revision:5}),ctx(draft.id))).status,409);
});
test("draft write APIs reject cross-origin requests and oversized bodies",async()=>{
  const evil=await create(request("/api/studio/drafts","POST",{brief},userA,"https://evil.example"));
  assert.equal(evil.status,403);
  const huge=await create(request("/api/studio/drafts","POST",
    {brief:{...brief,purpose:"x".repeat(70000)}}));
  assert.equal(huge.status,413);
});
