import test,{beforeEach} from "node:test";
import assert from "node:assert/strict";
import {NextRequest} from "next/server.js";
import {createSessionToken} from "../lib/session-token.ts";
import {POST as importRoute} from "../app/api/studio/generation/jobs/[id]/draft/route.ts";
import {importMockJobAsDraft,getDraft,updateDraft,listDrafts} from "../lib/studio/drafts.ts";
import {addUser,seedStudioResultJob,resetTestDb} from "./mocks/db-pool.mjs";

const user="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const other="bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const jobId="cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const origin="http://localhost:3000";
const secret="studio-result-import-test-secret-longer-than-thirty-two-bytes";
const brief={brand:"테스트",industry:"서비스",purpose:"안내",audience:"고객",
 channel:"naver-blog",length:"medium"};
beforeEach(()=>{
 resetTestDb();
 process.env.NODE_ENV="test";
 process.env.DATABASE_URL="postgresql://mock:mock@localhost:5432/mock";
 process.env.MONSTERA_STUDIO_MOCK_ENABLED="true";
 process.env.MONSTERA_SESSION_SECRET=secret;
 process.env.MONSTERA_PUBLIC_ORIGIN=origin;
 addUser({id:user,email:"a@example.invalid",tier:"free",session_epoch:0,
  email_verified_at:new Date(),google_sub:"google-user-a"});
 addUser({id:other,email:"b@example.invalid",tier:"free",session_epoch:0,
  email_verified_at:new Date(),google_sub:"google-user-b"});
 seedStudioResultJob({id:jobId,user_id:user,status:"succeeded",execution_mode:"mock",
  result_text:"[MOCK] 생성한 한국어 테스트 결과",result_draft_id:null});
});
function request(id=user,body={brief},reqOrigin=origin){
 return new NextRequest(origin+"/api/studio/generation/jobs/"+jobId+"/draft",{
  method:"POST",headers:{origin:reqOrigin,"content-type":"application/json",
    cookie:"monstera_session="+createSessionToken(id,0,secret)},
  body:JSON.stringify(body),
 });
}
const context={params:Promise.resolve({id:jobId})};
test("import creates only unreviewed server-owned draft",async()=>{
 const record=await importMockJobAsDraft(user,jobId,brief);
 assert.equal(record.userId,user);
 assert.equal(record.state,"DRAFT");
 assert.equal(record.checks,null);
 assert.match(record.content.post,/MOCK/);
 assert.equal((await listDrafts(user)).length,1);
 const checked=await getDraft(user,record.id);
 assert.equal(checked.revision,1);
});
test("replay returns original draft without overwriting manual edits",async()=>{
 const record=await importMockJobAsDraft(user,jobId,brief);
 const modified=await updateDraft(user,record.id,"edit",1,
  {content:{...record.content,post:"사람이 작성한 수정 결과"}});
 assert.equal(modified.revision,2);
 const replay=await importMockJobAsDraft(user,jobId,{...brief,brand:"변경 시도"});
 assert.equal(replay.id,record.id);
 assert.equal(replay.revision,2);
 assert.equal(replay.content.post,"사람이 작성한 수정 결과");
 assert.equal((await listDrafts(user)).length,1);
});
test("result import denies other owners and incomplete jobs",async()=>{
 await assert.rejects(importMockJobAsDraft(other,jobId,brief),{status:404});
 seedStudioResultJob({id:jobId,user_id:user,status:"queued",execution_mode:"mock",
  result_text:null,result_draft_id:null});
 await assert.rejects(importMockJobAsDraft(user,jobId,brief),{status:409});
});
test("authenticated import API enforces owner, Origin and mock gate",async()=>{
 assert.equal((await importRoute(request(other),context)).status,404);
 assert.equal((await importRoute(request(user,{brief},"https://evil.example"),context)).status,403);
 const result=await importRoute(request(),context);
 assert.equal(result.status,200);
 const body=await result.json();
 assert.equal(body.mockOnly,true);
 assert.equal(body.draft.state,"DRAFT");
 assert.equal((await importRoute(request(),context)).status,200);
 process.env.NODE_ENV="production";
 assert.equal((await importRoute(request(),context)).status,501);
});
