"use client";
import { useCallback, useState } from "react";
import type { Tier } from "@/lib/router";
import { REVIEW_CHECKS, type StudioRecord, type Action } from "@/lib/studio/workflow";

const checkLabels: Record<(typeof REVIEW_CHECKS)[number],string> = {
  edited:"내용을 직접 편집·검토했습니다.",
  rights:"이미지·상표·음원 등 사용 권리를 확인했습니다.",
  facts:"사실관계와 과장·오해 소지를 확인했습니다.",
  commercial:"광고·협찬 표시와 플랫폼 규정을 확인했습니다.",
  likeness:"실존 인물·초상권·개인정보를 확인했습니다.",
};
const emptyChecks = () => Object.fromEntries(REVIEW_CHECKS.map(x=>[x,false])) as Record<(typeof REVIEW_CHECKS)[number],boolean>;

export function StudioWorkspace({tier}:{tier:Tier}) {
  const [brand,setBrand] = useState("");
  const [purpose,setPurpose] = useState("");
  const [record,setRecord] = useState<StudioRecord|null>(null);
  const [drafts,setDrafts] = useState<StudioRecord[]>([]);
  const [post,setPost] = useState("");
  const [checks,setChecks] = useState(emptyChecks);
  const [markdown,setMarkdown] = useState("");
  const [message,setMessage] = useState("서버에 초안이 저장되며 자동 게시하거나 AI 공급자를 호출하지 않습니다.");
  const [busy,setBusy] = useState(false);
  const dirty = !!record && post !== record.content.post;

  const activate = useCallback((draft:StudioRecord) => {
    setRecord(draft);
    setPost(draft.content.post);
    setChecks(draft.checks ?? emptyChecks());
    setMarkdown("");
  }, []);

  async function requestJson(url:string, method:"GET"|"POST"|"PATCH", body?:unknown) {
    const response=await fetch(url,{
      method, credentials:"same-origin", cache:"no-store",
      headers:body===undefined?undefined:{"content-type":"application/json"},
      body:body===undefined?undefined:JSON.stringify(body),
    });
    if (!response.ok) {
      if (response.status===409) throw new Error("다른 작업으로 초안 버전이 변경됐습니다. 목록을 새로 불러오세요.");
      if (response.status===403) throw new Error("현재 계정에서 허용되지 않는 작업입니다.");
      if (response.status===401) throw new Error("세션이 만료되었습니다. 다시 로그인하세요.");
      if (response.status===404) throw new Error("이 초안을 조회할 권한이 없거나 존재하지 않습니다.");
      throw new Error("요청 실패 ("+response.status+"). 저장 상태를 확인하세요.");
    }
    return response.json();
  }
  async function run(task:()=>Promise<void>) {
    if (busy) return;
    setBusy(true);
    try { await task(); } catch(error) {
      setMessage(error instanceof Error?error.message:"요청을 처리하지 못했습니다.");
    } finally { setBusy(false); }
  }
  const reload=()=>run(async()=>{
    const data=await requestJson("/api/studio/drafts","GET");
    setDrafts(data.drafts);
    setMessage("최근 초안 최대 50개를 불러왔습니다.");
  });
  const create=()=>run(async()=>{
    const data=await requestJson("/api/studio/drafts","POST",{
      brief:{brand,industry:"일반",purpose,audience:"일반 고객",channel:"naver-blog",length:"medium"},
    });
    activate(data.draft);
    setDrafts(current=>[data.draft,...current.filter(item=>item.id!==data.draft.id)]);
    setMessage("수동 편집용 데모 초안을 서버에 저장했습니다. AI 생성 결과가 아닙니다.");
  });
  const transition=(action:Action)=>run(async()=>{
    if(!record) return;
    if(action!=="edit" && dirty) {setMessage("편집한 내용을 먼저 저장해야 다음 단계로 진행할 수 있습니다.");return;}
    const body:Record<string,unknown>={action,revision:record.revision};
    if(action==="edit") body.content={...record.content,post};
    if(action==="approve") body.checks=checks;
    const data=await requestJson("/api/studio/drafts/"+encodeURIComponent(record.id),"PATCH",body);
    activate(data.draft);
    setDrafts(current=>[data.draft,...current.filter(item=>item.id!==data.draft.id)]);
    setMessage({edit:"수정 내용이 서버에 저장됐습니다. 이전 승인은 무효화됩니다.",review:"검수 대기 상태로 변경했습니다.",approve:"5개 항목을 기록하고 승인했습니다. 법적 권리 증명은 아닙니다.",export:"내보냈습니다."}[action]);
  });
  const exportNow=()=>run(async()=>{
    if(!record) return;
    if(dirty){setMessage("편집 내용을 먼저 저장하세요.");return;}
    const data=await requestJson("/api/studio/drafts/"+encodeURIComponent(record.id)+"/export","POST",{revision:record.revision});
    setMarkdown(data.markdown);
    setRecord(current=>current?{...current,revision:current.revision+1,state:"EXPORTED"}:current);
    setMessage("승인된 서버 버전을 수동 전달용 Markdown으로 내보냈습니다. 게시·전송은 하지 않았습니다.");
  });
  return <section className="space-y-5 rounded-xl border p-5">
    <h2 className="text-xl font-medium">콘텐츠 제작 및 승인</h2>
    <p className="text-sm">현재 티어: {tier} · 브리프/초안은 인증된 사용자 계정에만 저장됩니다.</p>
    <div className="grid gap-3 sm:grid-cols-2">
      <label className="block text-sm">브랜드명
        <input className="mt-1 w-full rounded border p-2 text-black" value={brand} onChange={e=>setBrand(e.target.value)} maxLength={80}/></label>
      <label className="block text-sm">제작 목적
        <input className="mt-1 w-full rounded border p-2 text-black" value={purpose} onChange={e=>setPurpose(e.target.value)} maxLength={300}/></label>
    </div>
    <div className="flex flex-wrap gap-2">
      <button type="button" disabled={busy} className="rounded border px-4 py-2 disabled:opacity-50" onClick={create}>데모 초안 서버 저장</button>
      <button type="button" disabled={busy} className="rounded border px-4 py-2 disabled:opacity-50" onClick={reload}>저장된 초안 불러오기</button>
    </div>
    {drafts.length>0 && <label className="block text-sm">내 초안 선택
      <select className="mt-1 w-full rounded border p-2 text-black" value={record?.id??""}
        onChange={e=>{const found=drafts.find(x=>x.id===e.target.value); if(found) activate(found);}}>
        <option value="">초안 선택</option>
        {drafts.map(item=><option key={item.id} value={item.id}>{item.brief.brand} · {item.state} · v{item.revision}</option>)}
      </select>
    </label>}
    {record && <>
      <p className="text-sm">상태: <strong>{record.state}</strong> · revision {record.revision}{dirty?" · 미저장 수정":""}</p>
      <label className="block text-sm">초안 편집
        <textarea className="mt-1 min-h-48 w-full rounded border p-2 text-black" value={post}
          onChange={e=>setPost(e.target.value)} maxLength={15000}/></label>
      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={busy || !dirty} className="rounded border px-3 py-2 disabled:opacity-50" onClick={()=>transition("edit")}>수정 저장</button>
        <button type="button" disabled={busy || dirty || record.state!=="DRAFT"} className="rounded border px-3 py-2 disabled:opacity-50" onClick={()=>transition("review")}>검수 시작</button>
      </div>
      {record.state==="REVIEW_REQUIRED" && <fieldset className="space-y-2 rounded border p-3"><legend className="px-2 font-medium">5개 필수 검수</legend>
        {REVIEW_CHECKS.map(key=><label key={key} className="flex gap-2 text-sm"><input type="checkbox" checked={checks[key]}
          onChange={e=>setChecks(old=>({...old,[key]:e.target.checked}))}/>{checkLabels[key]}</label>)}
        <button type="button" disabled={busy || dirty || !REVIEW_CHECKS.every(key=>checks[key])} className="rounded border px-3 py-2 disabled:opacity-50" onClick={()=>transition("approve")}>검수 승인</button>
      </fieldset>}
      {(record.state==="APPROVED" || record.state==="EXPORTED") &&
        <button type="button" disabled={busy || dirty} className="rounded border px-3 py-2 disabled:opacity-50" onClick={exportNow}>승인 버전 Markdown 내보내기</button>}
    </>}
    {markdown && <label className="block text-sm">수동 전달용 Markdown
      <textarea readOnly className="mt-1 min-h-48 w-full rounded border p-2 font-mono text-black" value={markdown}/></label>}
    <p role="status" className="text-sm">{message}</p>
    <p className="text-xs">승인 기록은 법적 권리 증명이 아니며, 실제 게시·납품·외부 AI 호출은 실행하지 않습니다.</p>
  </section>;
}
