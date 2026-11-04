// Used only by the explicit loopback demo launcher. Never imported by application code.
const nativeFetch = globalThis.fetch;
const prefix = "https://api.venice.ai/api/v1/";
globalThis.fetch = async (input, options = {}) => {
  const url = String(input instanceof Request ? input.url : input);
  if (!url.startsWith(prefix)) {
    const target = new URL(url);
    if (["127.0.0.1", "localhost", "[::1]"].includes(target.hostname)) return nativeFetch(input, options);
    throw new Error("OFFLINE_DEMO_EXTERNAL_NETWORK_BLOCKED");
  }
  if (options.signal?.aborted) throw new DOMException("aborted", "AbortError");
  if (url.endsWith("models?type=text")) return Response.json({ data: [
    { id: "demo-private", type: "text", model_spec: { privacy: "private", name: "오프라인 데모 (실제 AI 아님)" } },
    { id: "demo-private-2", type: "text", model_spec: { privacy: "private", name: "오프라인 데모 2 (실제 AI 아님)" } },
  ] });
  if (!url.endsWith("chat/completions")) throw new Error("OFFLINE_DEMO_UNKNOWN_ENDPOINT");
  const encoder = new TextEncoder();
  const fragments = ["오프라인 Mock 응답입니다. ", "실제 AI 또는 Venice 연결이 아닙니다. ", "모델 선택, 스트리밍, 중단, 새로고침 동작을 확인할 수 있습니다."];
  let timer, closed = false;
  let finish;
  const stream = new ReadableStream({
    start(controller) {
      finish = () => { if (!closed) { closed = true; clearInterval(timer); options.signal?.removeEventListener("abort", finish); controller.close(); } };
      options.signal?.addEventListener("abort", finish, { once: true });
      timer = setInterval(() => {
        if (closed) return;
        const fragment = fragments.shift();
        if (fragment) controller.enqueue(encoder.encode('data: ' + JSON.stringify({ choices: [{ delta: { content: fragment } }] }) + '\n\n'));
        else { controller.enqueue(encoder.encode('data: [DONE]\n\n')); finish(); }
      }, 250);
    },
    cancel() { closed = true; clearInterval(timer); options.signal?.removeEventListener("abort", finish); },
  });
  return new Response(stream, { headers: { "content-type": "text/event-stream" } });
};
