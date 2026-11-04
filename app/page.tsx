"use client";
import { useEffect, useRef, useState } from "react";

type Message = { role: "user" | "assistant"; content: string };
const DB_NAME = "monstera-alpha-local";
function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore("chat");
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function loadChat(): Promise<Message[]> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("chat", "readonly");
    const req = tx.objectStore("chat").get("messages");
    req.onsuccess = () => { db.close(); resolve(Array.isArray(req.result) ? req.result : []); };
    req.onerror = () => { db.close(); reject(req.error); };
  });
}
async function saveChat(messages: Message[]) {
  const db = await openDb();
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction("chat", "readwrite");
    tx.objectStore("chat").put(messages, "messages");
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { db.close(); reject(tx.error); };
  });
}
export default function HomePage() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [persist, setPersist] = useState(false);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("로컬 대화 기록을 불러오는 중입니다.");
  const abortRef = useRef<AbortController | null>(null);
  const messagesRef = useRef<Message[]>([]);
  useEffect(() => { setNotice("비공개 휘발 세션입니다. 기본적으로 이 기기에 대화를 저장하지 않습니다."); return () => abortRef.current?.abort(); }, []);
  const update = (items: Message[]) => { messagesRef.current = items; setMessages([...items]); if (persist) void saveChat(items).catch(() => setNotice("로컬 기록 저장 실패")); };
  async function send() {
    const content = input.trim();
    if (!content || busy) return;
    const history = [...messagesRef.current, { role: "user" as const, content }];
    setInput(""); setBusy(true); setNotice(""); update(history);
    const abort = new AbortController(); abortRef.current = abort;
    let answer = ""; let completed = false;
    try {
      const response = await fetch("/api/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ messages: history.slice(-20) }), signal: abort.signal });
      if (!response.ok || !response.body) throw new Error(`HTTP ${response.status}`);
      const reader = response.body.getReader();
      const decoder = new TextDecoder(); let buffer = "";
      while (true) {
        const { value, done } = await reader.read(); if (done) break;
        buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, "\n");
        let index: number;
        while ((index = buffer.indexOf("\n\n")) >= 0) {
          const event = buffer.slice(0, index); buffer = buffer.slice(index + 2);
          const kind = event.split("\n").find(x => x.startsWith("event: "))?.slice(7);
          const data = event.split("\n").find(x => x.startsWith("data: "))?.slice(6);
          if (kind === "error") throw new Error("CHAT_FAILED");
          if (kind === "done") completed = true;
          if (kind === "delta" && data) {
            const parsed: unknown = JSON.parse(data);
            if (parsed && typeof parsed === "object" && "text" in parsed && typeof parsed.text === "string") answer += parsed.text;
            update([...history, { role: "assistant", content: answer }]);
          }
        }
      }
      if (!completed) throw new Error("CHAT_FAILED");
    } catch (error) {
      setNotice(abort.signal.aborted ? "응답을 중단했습니다. 받은 내용만 저장했습니다." : `응답 오류: ${error instanceof Error ? error.message : "CHAT_FAILED"}`);
    } finally { if (answer) update([...history, { role: "assistant", content: answer }]); setBusy(false); abortRef.current = null; }
  }
  return <main className="mx-auto max-w-3xl p-6 md:p-12"><div className="mb-8"><h1 className="text-3xl font-bold">MONSTERA AI <span className="text-sm font-normal text-slate-500">Privacy Alpha 0.1</span></h1><p className="mt-2 text-slate-500">기본값: 세션 종료 시 대화 소멸 · 서버 대화 저장 없음 · AI 공급업체는 요청을 처리합니다.</p><label className="mt-4 flex items-center gap-2 text-sm"><input type="checkbox" checked={persist} disabled={busy} onChange={async e => { const enabled = e.target.checked; if (enabled) { const saved = await loadChat().catch(() => []); if (messagesRef.current.length === 0 && saved.length > 0) { messagesRef.current = saved; setMessages(saved); } else if (messagesRef.current.length > 0) { await saveChat(messagesRef.current).catch(() => setNotice("로컬 저장 실패")); } setPersist(true); } else { setPersist(false); } }} /> 이 브라우저에 대화 저장 허용 (현재 버전: 평문 저장)</label></div><section className="space-y-4 min-h-80 mb-6" aria-label="대화">{messages.map((m, i) => <article key={i} className={`rounded-xl p-4 whitespace-pre-wrap ${m.role === "user" ? "bg-slate-100" : "bg-emerald-50"}`}><div className="text-xs font-semibold mb-2">{m.role === "user" ? "나" : "MONSTERA AI"}</div>{m.content}</article>)}</section>{notice && <p role="status" className="mb-3 text-amber-700">{notice}</p>}<form onSubmit={e => { e.preventDefault(); void send(); }}><textarea aria-label="메시지" value={input} onChange={e => setInput(e.target.value)} maxLength={4000} rows={4} placeholder="무엇을 도와드릴까요?" className="w-full border rounded-xl p-3 text-slate-900" disabled={busy}/><div className="flex gap-3 mt-3"><button type="submit" disabled={busy || !input.trim()} className="rounded-lg bg-emerald-700 px-5 py-2 text-white disabled:opacity-40">전송</button><button type="button" disabled={!busy} onClick={() => abortRef.current?.abort()} className="rounded-lg border px-5 py-2 disabled:opacity-40">중단</button><button type="button" disabled={busy} onClick={() => { update([]); void saveChat([]).catch(() => setNotice("저장 기록 삭제 실패")); setNotice("현재 대화와 이 브라우저의 저장 기록을 지웁니다."); }} className="ml-auto rounded-lg border px-4 py-2">기록 삭제</button></div></form><p className="mt-6 text-xs text-slate-500">비공개 테스트용입니다. 공급업체(OpenRouter 또는 Venice)에서 요청을 처리합니다. Private 모델은 종단 간 암호화(E2EE)와 다릅니다. 저장을 켜면 현재 버전의 IndexedDB는 암호화되지 않습니다. 민감정보를 입력하지 마세요.</p></main>;
}
