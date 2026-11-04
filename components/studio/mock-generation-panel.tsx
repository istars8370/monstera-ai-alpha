"use client";
import { useCallback, useEffect, useState } from "react";
import type { StudioRecord } from "@/lib/studio/workflow";

interface ModelOption {id:string;label:string;tierMin:string;}
interface JobStatus {
  id:string;status:string;attempt_count?:number;max_attempts?:number;
  last_error_code?:string|null;result_text?:string|null;
  usage_in_tokens?:number|null;usage_out_tokens?:number|null;
  result_draft_id?:string|null;
}

export function StudioMockGeneration({
  brand,purpose,onDraft,
}:{
  brand:string;purpose:string;onDraft:(draft:StudioRecord)=>void;
}) {
  const [enabled,setEnabled]=useState(false);
  const [models,setModels]=useState<ModelOption[]>([]);
  const [modelId,setModelId]=useState("");
  const [prompt,setPrompt]=useState("");
  const [maxTokens,setMaxTokens]=useState(128);
  const [consent,setConsent]=useState(false);
  const [requestId,setRequestId]=useState("");
  const [preflight,setPreflight]=useState<number|null>(null);
  const [job,setJob]=useState<JobStatus|null>(null);
  const [message,setMessage]=useState("Mock은 실제 AI를 호출하지 않으며 자동 게시도 하지 않습니다.");
  const [busy,setBusy]=useState(false);

  useEffect(()=>{
    let mounted=true;
    fetch("/api/studio/generation/models",{credentials:"same-origin",cache:"no-store"})
      .then(async res=>{if(!res.ok)throw new Error("모델 목록을 가져오지 못했습니다.");return res.json();})
      .then(data=>{
        if(!mounted)return;
        setEnabled(data.mockEnabled===true);
        setModels(Array.isArray(data.models)?data.models:[]);
      }).catch(()=>{if(mounted)setMessage("모델을 확인할 수 없습니다. Mock 생성은 비활성화됩니다.");});
    return ()=>{mounted=false;};
  },[]);

  const clearRequest=useCallback(()=>{setRequestId("");setPreflight(null);setJob(null);},[]);
  async function call(path:string,method:"GET"|"POST",body?:unknown):Promise<Record<string,unknown>> {
    const response=await fetch(path,{method,cache:"no-store",credentials:"same-origin",
      ...(body===undefined?{}:{headers:{"content-type":"application/json"},body:JSON.stringify(body)})});
    const data=await response.json().catch(()=>({})) as Record<string,unknown>;
    if(!response.ok){
      if(response.status===402)throw new Error("텍스트 크레딧 잔액이 부족합니다.");
      if(response.status===409)throw new Error("중복 요청이거나 작업 버전이 변경됐습니다.");
      if(response.status===501)throw new Error("Mock 작업은 비운영 로컬 환경에서만 허용됩니다.");
      throw new Error("요청 실패 ("+response.status+"). 저장 상태를 확인하세요.");
    }
    return data;
  }
  async function run(task:()=>Promise<void>){
    if(busy)return;
    setBusy(true);
    try{await task();}catch(error){setMessage(error instanceof Error?error.message:"Mock 처리에 실패했습니다.");}
    finally{setBusy(false);}
  }
  function requestBody(){
    return {modelId,modality:"text",prompt,maxTokens,consentExternal:consent};
  }
  const check=()=>run(async()=>{
    const result=await call("/api/studio/generation/preflight","POST",requestBody());
    setPreflight(result.maximumReservedCredits as number);
    setMessage("사전 검증 성공: 실제 크레딧 예약은 아직 하지 않았습니다.");
  });
  const submit=()=>run(async()=>{
    const id=requestId||crypto.randomUUID();
    setRequestId(id);
    const data=await call("/api/studio/generation/jobs","POST",{...requestBody(),requestId:id});
    setJob({id:data.jobId as string,status:data.status as string});
    setMessage("Mock Job을 서버에 예약했습니다. 별도 로컬 워커가 실행해야 결과가 생성됩니다.");
  });
  const refresh=()=>run(async()=>{
    if(!job)return;
    const result=await call("/api/studio/jobs/"+encodeURIComponent(job.id),"GET");
    const next=result.job as JobStatus;
    setJob(next);
    setMessage(next.status==="succeeded"
      ?"Mock 결과가 준비됐습니다. 직접 초안 저장을 눌러 검수를 진행하세요."
      :"현재 Job 상태: "+next.status);
  });
  const importDraft=()=>run(async()=>{
    if(!job||job.status!=="succeeded")return;
    const result=await call("/api/studio/generation/jobs/"+encodeURIComponent(job.id)+"/draft","POST",{
      brief:{brand,industry:"일반",purpose,audience:"일반 고객",channel:"naver-blog",length:"medium"},
    });
    onDraft(result.draft as unknown as StudioRecord);
    setMessage("Mock 결과를 승인되지 않은 서버 초안으로 가져왔습니다. 직접 검수해야 합니다.");
  });
  const ready=enabled&&!!modelId&&!!prompt.trim()&&consent&&maxTokens>0&&!busy;
  return <section className="space-y-3 rounded-xl border p-4" aria-label="Mock 생성 테스트">
    <h3 className="text-lg font-medium">Mock 텍스트 생성 · 비운영 테스트</h3>
    <p className="text-xs">실제 OpenAI 호출·이미지·영상 생성·게시를 수행하지 않습니다. 별도 로컬 워커가 필요합니다.</p>
    {!enabled?<p className="text-sm">서버가 Mock 기능을 비활성화했습니다. 기존 수동 초안 기능은 계속 사용할 수 있습니다.</p>:<>
      <label className="block text-sm">사용 가능한 텍스트 모델
        <select className="mt-1 w-full rounded border p-2 text-black" value={modelId}
          onChange={e=>{setModelId(e.target.value);clearRequest();}}>
          <option value="">모델 선택</option>
          {models.map(m=><option key={m.id} value={m.id}>{m.label} · {m.tierMin}</option>)}
        </select>
      </label>
      <label className="block text-sm">Mock 입력 프롬프트
        <textarea className="mt-1 min-h-24 w-full rounded border p-2 text-black" value={prompt}
          maxLength={8192} onChange={e=>{setPrompt(e.target.value);clearRequest();}}/>
      </label>
      <label className="block text-sm">출력 토큰 한도
        <input type="number" className="ml-2 w-24 rounded border p-1 text-black" min={1} max={8192}
          value={maxTokens} onChange={e=>{setMaxTokens(Number(e.target.value));clearRequest();}}/>
      </label>
      <label className="flex gap-2 text-sm">
        <input type="checkbox" checked={consent} onChange={e=>{setConsent(e.target.checked);clearRequest();}}/>
        외부 공급자로 전달할 경우를 대비한 브리프 제공 동의 (현재는 전송하지 않음)
      </label>
      <div className="flex flex-wrap gap-2">
        <button type="button" className="rounded border px-3 py-2 disabled:opacity-50" disabled={!ready} onClick={check}>예상 크레딧 확인</button>
        <button type="button" className="rounded border px-3 py-2 disabled:opacity-50"
          disabled={!ready||preflight===null||job!==null} onClick={submit}>Mock Job 제출</button>
      </div>
      {preflight!==null&&<p className="text-sm">최대 예약 예상액: {preflight.toLocaleString()} 크레딧 (정책값·실사용 아님)</p>}
      {job&&<div className="space-y-2 rounded border p-3">
        <p className="text-sm">Job: <strong>{job.status}</strong> · 시도 {job.attempt_count??"?"}/{job.max_attempts??"?"}</p>
        <button type="button" className="rounded border px-3 py-2 disabled:opacity-50" disabled={busy} onClick={refresh}>Job 상태 새로고침</button>
        {job.status==="succeeded"&&<>
          <p className="text-xs">Mock 사용량: 입력 {job.usage_in_tokens??"?"}, 출력 {job.usage_out_tokens??"?"} 토큰</p>
          <textarea className="min-h-32 w-full rounded border p-2 text-black" readOnly value={job.result_text??""}/>
          <button type="button" className="rounded border px-3 py-2 disabled:opacity-50"
            disabled={busy||!brand.trim()||!purpose.trim()} onClick={importDraft}>Mock 결과를 초안으로 저장</button>
        </>}
        {job.last_error_code&&<p className="text-xs">실패 코드: {job.last_error_code}</p>}
      </div>}
    </>}
    <p role="status" className="text-xs">{message}</p>
  </section>;
}
