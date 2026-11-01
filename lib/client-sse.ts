// Streaming SSE framing for the private alpha browser UI. No server-side message persistence.
export type ChatSseEvent =
  | { kind: "delta"; text: string }
  | { kind: "error"; code: string }
  | { kind: "done" };

export class ChatSseParser {
  private readonly decoder = new TextDecoder();
  private buffer = "";
  private finished = false;
  private textLength = 0;

  push(chunk: Uint8Array): ChatSseEvent[] {
    if (this.finished) return [];
    this.buffer += this.decoder.decode(chunk, { stream: true });
    this.buffer = this.buffer.replace(/\r\n/g, "\n");
    const events: ChatSseEvent[] = [];
    let end: number;
    while ((end = this.buffer.indexOf("\n\n")) >= 0) {
      if (end > 65536) throw new Error("CHAT_SSE_FRAME_TOO_LARGE");
      const frame = this.buffer.slice(0, end);
      this.buffer = this.buffer.slice(end + 2);
      const lines = frame.split("\n");
      const kind = lines.find(line => line.startsWith("event:"))?.slice(6).trim();
      const data = lines.filter(line => line.startsWith("data:"))
        .map(line => line.slice(5).trimStart()).join("\n");
      if (!kind || !data) continue;
      let payload: unknown;
      try { payload = JSON.parse(data); } catch { throw new Error("INVALID_CHAT_SSE"); }
      if (!payload || typeof payload !== "object") throw new Error("INVALID_CHAT_SSE");
      if (kind === "done") {
        if (this.finished) throw new Error("DUPLICATE_CHAT_DONE");
        this.finished = true;
        events.push({ kind: "done" });
        this.buffer = "";
        break;
      }
      if (kind === "error") {
        const code = "code" in payload && typeof payload.code === "string"
          ? payload.code : "CHAT_FAILED";
        events.push({ kind: "error", code });
        continue;
      }
      if (kind === "delta") {
        if (!("text" in payload) || typeof payload.text !== "string") throw new Error("INVALID_CHAT_SSE");
        this.textLength += payload.text.length;
        if (this.textLength > 131072) throw new Error("CHAT_RESPONSE_TOO_LARGE");
        events.push({ kind: "delta", text: payload.text });
      }
    }
    if (this.buffer.length > 65536) throw new Error("CHAT_SSE_FRAME_TOO_LARGE");
    return events;
  }

  finish(): void {
    if (!this.finished) {
      this.buffer += this.decoder.decode();
      throw new Error("CHAT_INTERRUPTED");
    }
  }
}
