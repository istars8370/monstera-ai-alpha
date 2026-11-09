import type { ChatMessage } from "./providers/types";

// Make the request fit the same byte and message limits enforced by the server.
// The UI discloses this recent-context window before/while showing each response.
export function chatPayload(history: readonly ChatMessage[], model: string) {
  const messages: ChatMessage[] = [];
  for (const message of history.slice(-20).reverse()) {
    const candidate = { role: message.role, content: message.content.slice(-4000) };
    const next = [candidate, ...messages];
    if (new TextEncoder().encode(JSON.stringify({ model, messages: next })).byteLength > 24000) break;
    messages.unshift(candidate);
  }
  return { model, messages };
}
