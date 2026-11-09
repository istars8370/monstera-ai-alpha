"use client";
import { useEffect, useRef, useState } from "react";
import { ChatSseParser } from "@/lib/client-sse";
import { chatPayload } from "@/lib/chat-context";

type Message = { role: "user" | "assistant"; content: string };
type Catalog = { provider: string; privacy: string; models: { id: string; name: string }[]; maxOutputTokens: number };
const INITIAL_NOTICE = "휘발성 세션입니다. 새로고침하면 현재 대화가 사라집니다.";
const ERRORS: Record<string, string> = {
  NOT_CONFIGURED: "서버의 공급업체·API 키·모델 설정이 필요합니다.",
  MODEL_LOOKUP_FAILED: "모델 목록을 확인하지 못했습니다. 다른 공급업체로 전환하지 않았습니다.",
  RATE_LIMITED: "요청 제한에 도달했습니다. 잠시 후 다시 시도하세요.",
  INVALID_MODEL: "허용되지 않은 모델입니다. 모델 목록을 새로 확인하세요.",
  TOO_LARGE: "전송할 대화가 너무 큽니다. 현재 대화를 비우고 다시 시도하세요.",
};
export default function HomePage() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [model, setModel] = useState("");
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState(INITIAL_NOTICE);
  const [contextNotice, setContextNotice] = useState("");
  const [loading, setLoading] = useState(true);
  const abortRef = useRef<AbortController | null>(null);
  const sendingRef = useRef(false);
  const messagesRef = useRef<Message[]>([]);
  async function loadModels(signal?: AbortSignal) {
    setLoading(true);
    try {
      const response = await fetch("/api/models", { cache: "no-store", signal });
      const data = await response.json();
      if (!response.ok) throw new Error(ERRORS[data.code] || "모델 조회 실패");
      if (!Array.isArray(data.models)) throw new Error("잘못된 모델 목록");
      setCatalog(data); setModel(data.models[0]?.id || "");
      setNotice(data.models.length ? INITIAL_NOTICE : "설정된 모델 중 현재 사용 가능한 Private 모델이 없습니다.");
    } catch (error) {
      if (!signal?.aborted) { setCatalog(null); setModel(""); setNotice(error instanceof Error ? error.message : "모델 조회 실패"); }
    } finally { if (!signal?.aborted) setLoading(false); }
  }
  useEffect(() => {
    const abort = new AbortController();
    void loadModels(abort.signal);
    return () => { abort.abort(); abortRef.current?.abort(); };
  }, []);
  const update = (items: Message[]) => { messagesRef.current = items; setMessages([...items]); };
  async function send() {
    const content = input.trim();
    if (!content || sendingRef.current || !model) return;
    sendingRef.current = true;
    const history = [...messagesRef.current, { role: "user" as const, content }];
    const payload = chatPayload(history, model);
    setInput(""); setBusy(true); setNotice(""); update(history);
    setContextNotice(`이번 요청은 최근 ${payload.messages.length}개 메시지, 메시지당 최대 4,000자를 전송합니다.`);
    const abort = new AbortController(); abortRef.current = abort;
    let answer = "";
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    try {
      const response = await fetch("/api/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload), signal: abort.signal });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(ERRORS[data.code] || `연결 오류 (HTTP ${response.status})`);
      }
      if (!response.body) throw new Error("응답 스트림이 없습니다.");
      reader = response.body.getReader();
      const parser = new ChatSseParser();
      let completed = false;
      while (!completed) {
        const { value, done } = await reader.read(); if (done) break;
        for (const event of parser.push(value)) {
          if (event.kind === "error") throw new Error("응답을 완료하지 못했습니다. 다른 공급업체로 전환하지 않았습니다.");
          if (event.kind === "done") completed = true;
          if (event.kind === "delta") { answer += event.text; update([...history, { role: "assistant", content: answer }]); }
        }
      }
      parser.finish();
    } catch (error) {
      setNotice(abort.signal.aborted ? "응답을 중단했습니다. 받은 내용은 현재 화면에만 남습니다." : `응답 오류: ${error instanceof Error ? error.message : "연결 실패"}`);
    } finally {
      await reader?.cancel().catch(() => undefined); reader?.releaseLock();
      if (answer) update([...history, { role: "assistant", content: answer }]);
      sendingRef.current = false; setBusy(false); abortRef.current = null;
    }
  }
  return <main className="mx-auto max-w-3xl p-4 md:p-10">
    <header className="mb-6">
      <h1 className="text-3xl font-bold">MONSTERA AI <span className="text-sm font-normal text-slate-500">Privacy Alpha</span></h1>
      <p className="mt-2 text-slate-600">이 앱은 새 대화를 기기에 영구 저장하지 않습니다. MONSTERA 앱의 대화 DB는 사용하지 않습니다.</p>
      <div className="mt-4 rounded-xl border p-4 space-y-3">
        <p className="text-sm">공급업체: <strong>{catalog?.provider || "확인 중"}</strong> · 처리 방식: {catalog?.privacy === "private" ? "Private (Venice가 분류한 정책 기반 등급 · 실제 미보관 여부 미검증)" : catalog ? "선택 공급업체 정책 적용" : "미확인"}</p>
        <div className="flex flex-wrap items-center gap-2">
          <label htmlFor="model" className="text-sm">모델</label>
          <select id="model" value={model} disabled={busy || loading || !catalog?.models.length} onChange={e => setModel(e.target.value)} className="min-w-0 flex-1 rounded-lg border p-2 text-slate-900">
            {!model && <option value="">사용 가능한 모델 없음</option>}
            {catalog?.models.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
          <button type="button" disabled={busy || loading} onClick={() => void loadModels()} className="rounded-lg border px-3 py-2 disabled:opacity-40">모델 새로고침</button>
        </div>
        <p className="text-xs text-slate-600">현재 공급업체로 최근 대화가 전송됩니다. 공급업체 변경은 서버 설정에서 선택합니다. 자동 전환 없음 · 응답 최대 1,024토큰</p>
      </div>
    </header>
    <section className="space-y-4 min-h-64 mb-6" aria-label="대화" aria-busy={busy}>
      {!messages.length && <p className="py-12 text-center text-slate-500">사업, 개발, 일상 업무를 여기서 시작하세요.</p>}
      {messages.map((m, i) => <article key={i} className={`rounded-xl p-4 whitespace-pre-wrap break-words ${m.role === "user" ? "bg-slate-100" : "bg-emerald-50"}`}><div className="text-xs font-semibold mb-2">{m.role === "user" ? "나" : "MONSTERA AI"}</div>{m.content}</article>)}
    </section>
    {contextNotice && <p className="mb-2 text-xs text-slate-500">{contextNotice}</p>}
    {notice && <p role="status" className="mb-3 text-amber-800">{notice}</p>}
    <form onSubmit={e => { e.preventDefault(); void send(); }}>
      <textarea aria-label="메시지" value={input} onChange={e => setInput(e.target.value)} maxLength={4000} rows={4} placeholder="무엇을 도와드릴까요?" className="w-full border rounded-xl p-3 text-slate-900" disabled={busy}/>
      <div className="flex flex-wrap gap-2 mt-3">
        <button type="submit" disabled={busy || loading || !model || !input.trim()} className="rounded-lg bg-emerald-700 px-5 py-2 text-white disabled:opacity-40">{busy ? "응답 중…" : "전송"}</button>
        <button type="button" disabled={!busy} onClick={() => abortRef.current?.abort()} className="rounded-lg border px-5 py-2 disabled:opacity-40">중단</button>
        <button type="button" disabled={busy} onClick={() => { update([]); setInput(""); setContextNotice(""); setNotice("현재 화면의 대화를 비웠습니다. 기존 기기 저장 기록은 변경하지 않았습니다."); }} className="sm:ml-auto rounded-lg border px-4 py-2">현재 대화 비우기</button>
      </div>
    </form>
    <footer className="mt-6 space-y-2 text-xs text-slate-600">
      <p>Private는 E2EE·TEE·로컬 실행과 다릅니다. MONSTERA 서버와 선택 공급업체가 요청 본문을 처리합니다. 모델·공급업체의 제한이 적용됩니다.</p>
      <p>암호화 저장은 아직 연결되지 않아 저장 기능을 사용할 수 없습니다. 이전 버전의 기기 기록은 자동으로 읽거나 삭제하지 않습니다.</p>
    </footer>
  </main>;
}
