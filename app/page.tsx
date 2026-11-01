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
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("로컬 대화 기록을 불러오는 중입니다.");
  const abortRef = useRef<AbortController | null>(null);
  const messagesRef = useRef<Message[]>([]);
  useEffect(() => { loadChat().then(items => { messagesRef.current = items; setMessages(items); setNotice(""); }).catch(() => setNotice("로컬 저장소를 사용할 수 없습니다.")); return () => abortRef.current?.abort(); }, []);
  const update = (items: Message[]) => { messagesRef.current = items; setMessages([...items]); void saveChat(items).catch(() => setNotice("로컬 기록 저장 실패")); };
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
        buffer += decoder.decode(value, { stream: true });
        buffer = buffer.replace(/\r\n/g, "\n");
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
  return <main className="mx-auto max-w-3xl p-6 md:p-12"><div className="mb-8"><h1 className="text-3xl font-bold">MONSTERA AI <span className="text-sm font-normal text-slate-500">Alpha 0.1 · Private</span></h1><p className="mt-2 text-slate-500">OpenRouter 연결 · 대화는 이 브라우저에만 저장 · 과금 기능 비활성화</p></div><section className="space-y-4 min-h-80 mb-6" aria-label="대화">{messages.map((m, i) => <article key={i} className={`rounded-xl p-4 whitespace-pre-wrap ${m.role === "user" ? "bg-slate-100" : "bg-emerald-50"}`}><div className="text-xs font-semibold mb-2">{m.role === "user" ? "나" : "MONSTERA AI"}</div>{m.content}</article>)}</section>{notice && <p role="status" className="mb-3 text-amber-700">{notice}</p>}<form onSubmit={e => { e.preventDefault(); void send(); }}><textarea aria-label="메시지" value={input} onChange={e => setInput(e.target.value)} maxLength={4000} rows={4} placeholder="무엇을 도와드릴까요?" className="w-full border rounded-xl p-3 text-slate-900" disabled={busy}/><div className="flex gap-3 mt-3"><button type="submit" disabled={busy || !input.trim()} className="rounded-lg bg-emerald-700 px-5 py-2 text-white disabled:opacity-40">전송</button><button type="button" disabled={!busy} onClick={() => abortRef.current?.abort()} className="rounded-lg border px-5 py-2 disabled:opacity-40">중단</button><button type="button" disabled={busy} onClick={() => { update([]); setNotice("이 브라우저의 대화 기록을 지웠습니다."); }} className="ml-auto rounded-lg border px-4 py-2">기록 삭제</button></div></form><p className="mt-6 text-xs text-slate-500">비공개 테스트용입니다. 모델 제공업체(OpenRouter 및 선택 모델)는 요청 본문을 처리합니다. 민감정보를 입력하지 마세요.</p></main>;
}
