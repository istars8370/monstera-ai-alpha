"use client";
import { useState } from "react";
import { demoContent,validateBrief,validateContent,applyAction,exportApproved,type Brief,type StudioRecord } from "@/lib/studio/workflow";
import type { Tier } from "@/lib/router";
export function StudioWorkspace({tier}:{tier:Tier}) {
  const [brand,setBrand]=useState("");
  const [purpose,setPurpose]=useState("");
  const [post,setPost]=useState("");
  const [record,setRecord]=useState<StudioRecord|null>(null);
  const [message,setMessage]=useState("");
  function createDemo() {
    try {
      const brief:Brief=validateBrief({brand,industry:"일반",purpose,audience:"일반 고객",channel:"naver-blog",length:"medium"});
      const content=demoContent(brief);
      // Unpersisted demo is never treated as a saved, approved or exportable record.
      setRecord({id:"local-preview",userId:"",brief,content,revision:1,state:"DRAFT",checks:null});
      setPost(content.post);
      setMessage("로컬 미리보기입니다. 서버 저장 및 승인 기능은 아직 연결되지 않았습니다.");
    } catch {setMessage("브랜드와 목적을 입력하세요.");}
  }
  return <section className="space-y-4 rounded-xl border p-5">
    <h2 className="text-xl font-medium">콘텐츠 초안 (수동 편집용 데모)</h2>
    <p className="text-sm">현재 티어: {tier} · 외부 AI 호출과 자동 게시 기능은 실행하지 않습니다.</p>
    <label className="block">브랜드명<input className="mt-1 w-full rounded border p-2 text-black" value={brand} onChange={e=>setBrand(e.target.value)} maxLength={80}/></label>
    <label className="block">제작 목적<input className="mt-1 w-full rounded border p-2 text-black" value={purpose} onChange={e=>setPurpose(e.target.value)} maxLength={300}/></label>
    <button type="button" className="rounded bg-foreground px-4 py-2 text-background" onClick={createDemo}>데모 초안 작성</button>
    {record && <label className="block">초안 편집<textarea className="mt-1 min-h-48 w-full rounded border p-2 text-black" value={post} onChange={e=>setPost(e.target.value)} maxLength={15000}/></label>}
    <p role="status" className="text-sm">{message}</p>
    <p className="text-xs text-muted-foreground">권리·사실관계·초상권 검수와 서버 승인 기록을 갖추기 전에는 납품할 수 없습니다.</p>
  </section>;
}
