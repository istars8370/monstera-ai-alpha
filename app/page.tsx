"use client";

import { useEffect, useRef, useState } from "react";
import { ChatSseParser } from "@/lib/client-sse";
import { deleteAllLocalChat, deleteLocalChatForUser, loadChat, lockDeviceStorage, saveChat, unlockAndMigrate } from "@/lib/client-storage";

type Message = { role: "user" | "assistant"; content: string };
type ModelChoice = { id: string; label: string; provider: string; context: number };
export default function HomePage() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [models, setModels] = useState<ModelChoice[]>([]);
  const [availableCredits, setAvailableCredits] = useState<number | null>(null);
  const [modelId, setModelId] = useState("");
  const [signedIn, setSignedIn] = useState(false);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [passphrase, setPassphrase] = useState("");
  const [unlocked, setUnlocked] = useState(false);
  const [notice, setNotice] = useState("로컬 대화 기록을 불러오는 중입니다.");
  const abortRef = useRef<AbortController | null>(null);
  const messagesRef = useRef<Message[]>([]);

  const userIdRef = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/models", { cache: "no-store" }).then(async response => {
      if (!response.ok) return null;
      return await response.json() as { userId?: string; models?: ModelChoice[] };
    }).then(async data => {
      if (cancelled) return;
      if (!data || !data.userId || !Array.isArray(data.models)) {
        setNotice("로그인 후 AI 모델과 대화할 수 있습니다.");
        return;
      }
      userIdRef.current = data.userId;
      setSignedIn(true);
      setModels(data.models);
      setModelId(data.models[0]?.id ?? "");
      void fetch("/api/credits", { cache: "no-store" }).then(async response => {
        if (!response.ok) return null;
        return await response.json() as { available?: number };
      }).then(balance => {
        if (!cancelled && userIdRef.current === data.userId && typeof balance?.available === "number") {
          setAvailableCredits(balance.available);
        }
      }).catch(() => undefined);
      setNotice("로컬 기록이 잠겨 있습니다. 패스프레이즈로 잠금 해제하면 기존 기록도 암호화됩니다.");
    }).catch(() => { if (!cancelled) setNotice("인증 또는 모델 조회에 실패했습니다."); });
    const validateAccount = () => {
      const displayedUserId = userIdRef.current;
      if (!displayedUserId || cancelled) return;
      void fetch("/api/models", { cache: "no-store" }).then(async response => {
        if (!response.ok) return null;
        return await response.json() as { userId?: string };
      }).then(data => {
        if (cancelled || userIdRef.current !== displayedUserId) return;
        if (data?.userId !== displayedUserId) {
          abortRef.current?.abort();
          lockDeviceStorage();
          setUnlocked(false);
          setPassphrase("");
          userIdRef.current = null;
          messagesRef.current = [];
          setMessages([]);
          setSignedIn(false);
          setInput("");
          setModels([]);
          setModelId("");
          setAvailableCredits(null);
          setNotice("계정이 변경되었거나 세션이 만료되었습니다. 다시 로그인하세요.");
        }
      }).catch(() => undefined);
    };
    const onVisible = () => { if (document.visibilityState === "visible") validateAccount(); };
    window.addEventListener("focus", validateAccount);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      abortRef.current?.abort();
      lockDeviceStorage();
      window.removeEventListener("focus", validateAccount);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  const update = (items: Message[]) => {
    messagesRef.current = items;
    setMessages([...items]);
    const userId = userIdRef.current;
    if (userId && unlocked) {
      void saveChat(items, userId).catch(() => {
        if (userIdRef.current === userId) setNotice("암호화된 로컬 기록 저장 실패");
      });
    } else if (userId) {
      setNotice("기록이 잠겨 있어 저장하지 않았습니다. 잠금 해제 후 기록을 보존하세요.");
    }
  };
  async function unlockLocalHistory() {
    const userId = userIdRef.current;
    if (!userId || busy || !signedIn || !passphrase) return;
    try {
      const result = await unlockAndMigrate(userId, passphrase);
      setPassphrase("");
      if (userIdRef.current !== userId) { lockDeviceStorage(); return; }
      setUnlocked(true);
      if (result.failed > 0) {
        setNotice("암호화 마이그레이션 실패 기록 " + result.failed + "개. 원본을 보존했으므로 복구가 필요합니다.");
        return;
      }
      const records = await loadChat(userId);
      if (userIdRef.current !== userId) return;
      messagesRef.current = records;
      setMessages(records);
      setNotice(result.migrated
        ? "기존 평문 기록 " + result.migrated + "개를 암호화했습니다."
        : "로컬 기록 잠금 해제됨");
    } catch (error) {
      lockDeviceStorage();
      setUnlocked(false);
      setPassphrase("");
      setNotice("로컬 잠금 해제 실패: " +
        (error instanceof Error ? error.message : "DECRYPTION_FAILED"));
    }
  }
  function lockLocalHistory() {
    lockDeviceStorage();
    setUnlocked(false);
    setPassphrase("");
    messagesRef.current = [];
    setMessages([]);
    setInput("");
    setNotice("로컬 기록이 잠겼습니다. 암호화 키는 메모리에서 제거했습니다.");
  }
  async function logout() {
    if (busy) return;
    try {
      const response = await fetch("/api/auth/logout", { method: "POST" });
      if (!response.ok) throw new Error("LOGOUT_FAILED");
      lockDeviceStorage();
      setUnlocked(false);
      setPassphrase("");
      userIdRef.current = null;
      messagesRef.current = [];
      setMessages([]);
      setSignedIn(false);
      setInput("");
      setModels([]);
      setModelId("");
      setAvailableCredits(null);
      setNotice("로그아웃했습니다. 브라우저의 대화 기록은 유지됩니다.");
    } catch { setNotice("로그아웃 요청이 실패했습니다."); }
  }
  async function deleteCurrentHistory() {
    const userId = userIdRef.current;
    if (!userId || busy || !signedIn || !window.confirm("현재 로그인한 계정의 이 기기 대화 기록을 삭제하시겠습니까?")) return;
    try {
      await deleteLocalChatForUser(userId);
      if (userIdRef.current !== userId) return;
      messagesRef.current = [];
      setMessages([]);
      setNotice("현재 계정의 이 기기 대화 기록을 삭제했습니다.");
    } catch {
      if (userIdRef.current === userId) setNotice("현재 계정 기록 삭제에 실패했습니다.");
    }
  }
  async function deleteDeviceHistory() {
    if (busy || !window.confirm("이 브라우저에 저장된 모든 계정의 대화 기록을 삭제하시겠습니까?")) return;
    try {
      await deleteAllLocalChat();
      setUnlocked(false);
      setPassphrase("");
      messagesRef.current = [];
      setMessages([]);
      setInput("");
      setNotice("이 기기의 모든 계정 대화 기록을 삭제했습니다.");
    } catch {
      setNotice("기기 기록 삭제에 실패했습니다. 브라우저 저장소 권한을 확인하세요.");
    }
  }
  async function send() {
    const content = input.trim();
    const initiatingUserId = userIdRef.current;
    if (!content || busy || !modelId || !signedIn || !initiatingUserId) return;
    const history = [...messagesRef.current, { role: "user" as const, content }];
    setInput("");
    setBusy(true);
    setNotice("");
    update(history);
    const abort = new AbortController();
    abortRef.current = abort;
    const parser = new ChatSseParser();
    let answer = "";
    let completed = false;
    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Monstera-Expected-User": initiatingUserId,
        },
        body: JSON.stringify({ modelId, messages: history.slice(-20) }),
        signal: abort.signal,
      });
      if (response.status === 409) {
        abortRef.current?.abort();
        lockDeviceStorage();
        setUnlocked(false);
        setPassphrase("");
        userIdRef.current = null;
        messagesRef.current = [];
        setMessages([]);
        setSignedIn(false);
        setInput("");
        setModels([]);
        setModelId("");
        setAvailableCredits(null);
      }
      if (!response.ok || !response.body) {
        let code = "HTTP_" + response.status;
        try {
          const payload: unknown = await response.json();
          if (payload && typeof payload === "object" && "code" in payload && typeof payload.code === "string") code = payload.code;
        } catch { /* No error JSON */ }
        throw new Error(code);
      }
      const reader = response.body.getReader();
      try {
        while (!abort.signal.aborted) {
          const { value, done } = await reader.read();
          if (done) break;
          if (userIdRef.current !== initiatingUserId) {
            abort.abort();
            throw new Error("SESSION_CHANGED");
          }
          for (const event of parser.push(value)) {
            if (event.kind === "error") throw new Error(event.code);
            if (event.kind === "done") { completed = true; break; }
            answer += event.text;
            if (userIdRef.current === initiatingUserId) {
              update([...history, { role: "assistant", content: answer }]);
            }
          }
          if (completed) break;
        }
        parser.finish();
      } finally {
        if (!completed) await reader.cancel().catch(() => undefined);
        reader.releaseLock();
      }
    } catch (error) {
      if (userIdRef.current === initiatingUserId) {
        setNotice(abort.signal.aborted ? "응답을 중단했습니다. 받은 내용만 저장했습니다." :
          "응답 오류: " + (error instanceof Error ? error.message : "CHAT_FAILED"));
      }
    } finally {
      if (answer && userIdRef.current === initiatingUserId) {
        update([...history, { role: "assistant", content: answer }]);
      }
      setBusy(false);
      abortRef.current = null;
    }
  }
  return (
    <main className="mx-auto max-w-3xl p-6 md:p-12">
      <header className="mb-8">
        <h1 className="text-3xl font-bold">MONSTERA AI <span className="text-sm font-normal text-slate-500">Alpha · Private</span></h1>
        <p className="mt-2 text-slate-500">서버에는 대화 본문을 저장하지 않습니다. 패스프레이즈로 잠금 해제한 기록만 XChaCha20-Poly1305로 암호화해 저장합니다. 기존 평문 기록은 해당 계정에서 잠금 해제할 때 암호화됩니다.</p>
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
        {signedIn && (
          <section aria-label="로컬 기록 암호화" className="mt-3 rounded-lg border p-3">
            <p className="text-sm">{unlocked ? "로컬 기록 잠금 해제됨" : "로컬 기록 잠김 — 키 없이 저장하지 않습니다."}</p>
            {!unlocked ? (
              <div className="flex gap-2 mt-2 items-center">
                <label htmlFor="local-passphrase" className="text-sm">로컬 기록 암호</label>
                <input id="local-passphrase" aria-label="로컬 기록 암호" type="password"
                  autoComplete="new-password" value={passphrase}
                  onChange={event => setPassphrase(event.target.value)}
                  className="border rounded-lg px-3 py-2 flex-1 min-w-0" />
                <button type="button" disabled={busy || passphrase.length < 8}
                  onClick={() => void unlockLocalHistory()} className="rounded-lg border px-3 py-2">잠금 해제</button>
              </div>
            ) : (
              <button type="button" onClick={() => lockLocalHistory()}
                className="rounded-lg border px-3 py-2 mt-2">로컬 기록 잠그기</button>
            )}
          </section>
        )}
        {signedIn && <p className="mt-2 text-sm text-slate-500">내부 크레딧 가용 잔액: {availableCredits ?? "조회 불가"} · 유료 정산 비활성화</p>}
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
          <button type="button" disabled={busy || !signedIn} onClick={() => void deleteCurrentHistory()}
            className="ml-auto rounded-lg border px-4 py-2">현재 계정 기록 삭제</button>
          <button type="button" disabled={busy} onClick={() => void deleteDeviceHistory()} className="rounded-lg border px-4 py-2">이 기기 모든 기록 삭제</button>
        </div>
      </form>
      <p className="mt-6 text-xs text-slate-500">
        비공개 테스트용입니다. 모델 제공업체는 요청 본문을 처리합니다. 유료 크레딧 정산은 아직 비활성화되어 있습니다.
      </p>
    </main>
  );
}
