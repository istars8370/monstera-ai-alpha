"use client";

import { useEffect, useRef, useState } from "react";

type Message = { role: "user" | "assistant"; content: string };
type ModelChoice = { id: string; label: string; provider: string; context: number };
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
async function saveChat(messages: Message[]): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("chat", "readwrite");
    tx.objectStore("chat").put(messages, "messages");
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { db.close(); reject(tx.error); };
  });
}
export default function HomePage() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [models, setModels] = useState<ModelChoice[]>([]);
  const [modelId, setModelId] = useState("");
  const [signedIn, setSignedIn] = useState(false);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("로컬 대화 기록을 불러오는 중입니다.");
  const abortRef = useRef<AbortController | null>(null);
  const messagesRef = useRef<Message[]>([]);

  useEffect(() => {
    loadChat().then(items => {
      messagesRef.current = items;
      setMessages(items);
      setNotice("");
    }).catch(() => setNotice("로컬 기록 저장소를 사용할 수 없습니다."));
    fetch("/api/models", { cache: "no-store" }).then(async response => {
      if (!response.ok) return null;
      return await response.json() as { models?: ModelChoice[] };
    }).then(data => {
      if (Array.isArray(data?.models)) {
        setSignedIn(true);
        setModels(data.models);
        setModelId(data.models[0]?.id ?? "");
      }
    }).catch(() => undefined);
    return () => abortRef.current?.abort();
  }, []);

  const update = (items: Message[]) => {
    messagesRef.current = items;
    setMessages([...items]);
    void saveChat(items).catch(() => setNotice("로컬 기록 저장 실패"));
  };
  async function logout() {
    if (busy) return;
    try {
      const response = await fetch("/api/auth/logout", { method: "POST" });
      if (!response.ok) throw new Error("LOGOUT_FAILED");
      setSignedIn(false);
      setModels([]);
      setModelId("");
      setNotice("로그아웃했습니다. 브라우저의 대화 기록은 유지됩니다.");
    } catch { setNotice("로그아웃 요청이 실패했습니다."); }
  }
  async function send() {
    const content = input.trim();
    if (!content || busy || !modelId || !signedIn) return;
    const history = [...messagesRef.current, { role: "user" as const, content }];
    setInput("");
    setBusy(true);
    setNotice("");
    update(history);
    const abort = new AbortController();
    abortRef.current = abort;
    let answer = "";
    let completed = false;
    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ modelId, messages: history.slice(-20) }),
        signal: abort.signal,
      });
      if (!response.ok || !response.body) {
        let code = "HTTP_" + response.status;
        try { const payload: unknown = await response.json(); if (payload && typeof payload === "object" && "code" in payload && typeof payload.code === "string") code = payload.code; }
        catch { /* No error JSON */ }
        throw new Error(code);
      }
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        buffer = buffer.replace(/\r\n/g, "\n");
        let index: number;
        while ((index = buffer.indexOf("\n\n")) >= 0) {
          const event = buffer.slice(0, index);
          buffer = buffer.slice(index + 2);
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
      if (!completed) throw new Error("CHAT_INTERRUPTED");
    } catch (error) {
      setNotice(abort.signal.aborted ? "응답을 중단했습니다. 받은 내용만 저장했습니다." :
        "응답 오류: " + (error instanceof Error ? error.message : "CHAT_FAILED"));
    } finally {
      if (answer) update([...history, { role: "assistant", content: answer }]);
      setBusy(false);
      abortRef.current = null;
    }
  }
  return (
    <main className="mx-auto max-w-3xl p-6 md:p-12">
      <header className="mb-8">
        <h1 className="text-3xl font-bold">MONSTERA AI <span className="text-sm font-normal text-slate-500">Alpha · Private</span></h1>
        <p className="mt-2 text-slate-500">서버에는 대화 본문을 저장하지 않습니다. 기록은 이 브라우저에 저장됩니다.</p>
        <div className="flex gap-3 mt-4 items-center">
          {!signedIn ? (
            <a className="rounded-lg bg-emerald-700 text-white px-4 py-2" href="/api/auth/google">Google로 로그인</a>
          ) : (
            <>
              <label htmlFor="ai-model" className="text-sm font-medium">AI 모델</label>
              <select id="ai-model" aria-label="AI 모델" value={modelId} onChange={e => setModelId(e.target.value)}
                className="border rounded-lg p-2 flex-1 min-w-0" disabled={busy}>
                {models.length === 0 && <option value="">사용 가능한 모델 없음</option>}
                {models.map(m => <option key={m.id} value={m.id}>{m.label} ({m.provider})</option>)}
              </select>
              <button type="button" onClick={() => void logout()} disabled={busy} className="rounded-lg border px-3 py-2">로그아웃</button>
            </>
          )}
        </div>
      </header>
      <section className="space-y-4 min-h-80 mb-6" aria-label="대화">
        {messages.map((m, i) => (
          <article key={i} className={"rounded-xl p-4 whitespace-pre-wrap " + (m.role === "user" ? "bg-slate-100" : "bg-emerald-50")}>
            <div className="text-xs font-semibold mb-2">{m.role === "user" ? "나" : "MONSTERA AI"}</div>
            {m.content}
          </article>
        ))}
      </section>
      {notice && <p role="status" className="mb-3 text-amber-700">{notice}</p>}
      <form onSubmit={e => { e.preventDefault(); void send(); }}>
        <textarea aria-label="메시지" value={input} onChange={e => setInput(e.target.value)} maxLength={4000} rows={4}
          placeholder={signedIn ? "무엇을 도와드릴까요?" : "메시지를 보내려면 먼저 로그인하세요."}
          className="w-full border rounded-xl p-3 text-slate-900" disabled={busy || !signedIn || !modelId}/>
        <div className="flex gap-3 mt-3">
          <button type="submit" disabled={busy || !input.trim() || !modelId || !signedIn}
            className="rounded-lg bg-emerald-700 px-5 py-2 text-white disabled:opacity-40">전송</button>
          <button type="button" disabled={!busy} onClick={() => abortRef.current?.abort()} className="rounded-lg border px-5 py-2 disabled:opacity-40">중단</button>
          <button type="button" disabled={busy} onClick={() => { update([]); setNotice("이 브라우저의 대화 기록을 지웠습니다."); }}
            className="ml-auto rounded-lg border px-4 py-2">기록 삭제</button>
        </div>
      </form>
      <p className="mt-6 text-xs text-slate-500">
        비공개 테스트용입니다. 모델 제공업체는 요청 본문을 처리합니다. 유료 크레딧 정산은 아직 비활성화되어 있습니다.
      </p>
    </main>
  );
}
