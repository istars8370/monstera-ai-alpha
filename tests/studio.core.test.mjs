import test from "node:test";
import assert from "node:assert/strict";
import { calculateQuote } from "../lib/studio/quote.ts";
import { validateBrief, demoContent, applyAction, exportApproved } from "../lib/studio/workflow.ts";
const sample = {paid_krw:300000,cash_cost_krw:80000,labor_minutes:300,labor_rate_krw:30000,fee_krw:10000,refund_krw:0};
test("quote deducts KRW cash, labor and fees without credit operations",()=>{
 assert.deepEqual(calculateQuote(sample),{net_revenue_krw:300000,labor_cost_krw:150000,contribution_krw:60000,margin_pct:20});
 assert.equal(calculateQuote({...sample,paid_krw:0}).margin_pct,null);
 assert.equal(calculateQuote({...sample,labor_minutes:1,labor_rate_krw:30}).labor_cost_krw,1);
});
test("quote rejects invalid, negative, fractional and oversized inputs",()=>{
 for(const entry of [{paid_krw:-1},{paid_krw:0.1},{labor_minutes:0.1},{paid_krw:Number.MAX_SAFE_INTEGER},{fee_krw:NaN},{refund_krw:300001}]) {
  assert.throws(()=>calculateQuote({...sample,...entry}),RangeError);
 }
});
test("workflow has fail-closed review approvals and stale revision protection",()=>{
 const brief=validateBrief({brand:"가상 브랜드",industry:"생활",purpose:"새 제품 소개",audience:"고객",channel:"naver-blog",length:"medium"});
 const base={id:"demo",userId:"owner",revision:1,state:"DRAFT",brief,content:demoContent(brief),checks:null};
 assert.throws(()=>exportApproved(base),{status:409});
 const reviewed=applyAction(base,"review",1);
 const checks={edited:true,rights:true,facts:true,commercial:true,likeness:true};
 assert.throws(()=>applyAction(reviewed,"approve",2,{checks:{...checks,rights:false}}),{status:400});
 const approved=applyAction(reviewed,"approve",2,{checks});
 assert.match(exportApproved(approved),/수동 전달용/);
 assert.deepEqual(Object.keys(approved.checks).sort(),Object.keys(checks).sort());
 const withUntrustedExtra=applyAction(reviewed,"approve",2,{checks:{...checks,owner:"forged",rightsProof:"not-proven"}});
 assert.deepEqual(withUntrustedExtra.checks,checks);
 assert.throws(()=>applyAction(reviewed,"approve",2,{checks:[]}),{status:400});
 assert.throws(()=>applyAction(approved,"export",2),{status:409});
 const edited=applyAction(approved,"edit",3,{content:{...approved.content,post:"사람이 수정한 내용"}});
 assert.equal(edited.state,"DRAFT");
 assert.equal(edited.checks,null);
 assert.throws(()=>exportApproved(edited),{status:409});
});
