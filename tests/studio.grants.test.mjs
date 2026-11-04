import test,{beforeEach} from "node:test";
import assert from "node:assert/strict";
import {NextRequest} from "next/server.js";
import {createSessionToken} from "../lib/session-token.ts";
import {grantForTier,claimDailyGrant} from "../lib/studio/grants.ts";
import {POST as grantRoute} from "../app/api/studio/credits/grant/route.ts";
import {addUser,addCredits,resetTestDb} from "./mocks/db-pool.mjs";

const origin="http://localhost:3000";
const secret="test-grant-secret-longer-than-thirty-two-bytes";
const id="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
beforeEach(()=>{
 resetTestDb();
 process.env.MONSTERA_PUBLIC_ORIGIN=origin;
 process.env.MONSTERA_SESSION_SECRET=secret;
 process.env.MONSTERA_DAILY_GRANT_FREE_TEXT="10";
 process.env.MONSTERA_DAILY_GRANT_FREE_IMAGE="2";
 process.env.MONSTERA_DAILY_GRANT_FREE_VIDEO="0";
 addUser({id,email:"grant@example.invalid",tier:"free",session_epoch:0,
  google_sub:"grant-mock-user",email_verified_at:new Date()});
 addCredits(id,0);
});
test("daily grant configuration rejects unsafe values",()=>{
 assert.deepEqual(grantForTier("free",{MONSTERA_DAILY_GRANT_FREE_TEXT:"10",
  MONSTERA_DAILY_GRANT_FREE_IMAGE:"2",MONSTERA_DAILY_GRANT_FREE_VIDEO:"0"}),
  {text:10,image:2,video:0});
 for(const raw of ["-1","1.2","1000001","999999999999","bad"]){
  assert.throws(()=>grantForTier("free",{MONSTERA_DAILY_GRANT_FREE_TEXT:raw}));
 }
});
test("daily grant is UTC scoped and duplicate requests do not double spend",async()=>{
 const monday=new Date("2026-11-02T23:59:59Z");
 assert.deepEqual(await claimDailyGrant(id,"free",monday),{
   status:"granted",day:"2026-11-02",amounts:{text:10,image:2,video:0}});
 assert.deepEqual(await claimDailyGrant(id,"free",monday),{
   status:"already_granted",day:"2026-11-02",amounts:{text:0,image:0,video:0}});
 assert.equal((await claimDailyGrant(id,"free",new Date("2026-11-03T00:00:01Z"))).status,"granted");
});
test("grant route requires same-origin and authenticated session; ignores client overrides",async()=>{
 const unauthorized=await grantRoute(new NextRequest(origin+"/api/studio/credits/grant",{
   method:"POST",headers:{origin}}));
 assert.equal(unauthorized.status,401);
 const cookie="monstera_session="+createSessionToken(id,0,secret);
 const wrongOrigin=await grantRoute(new NextRequest(origin+"/api/studio/credits/grant",{
   method:"POST",headers:{cookie,origin:"https://evil.example"}}));
 assert.equal(wrongOrigin.status,403);
 const response=await grantRoute(new NextRequest(origin+"/api/studio/credits/grant",{
   method:"POST",headers:{cookie,origin}}));
 assert.equal(response.status,200);
 const data=await response.json();
 assert.deepEqual(data.amounts,{text:10,image:2,video:0});
});
