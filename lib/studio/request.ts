import { StudioInputError } from "@/lib/studio/workflow";

/** Cap the number of bytes read, not only the declared Content-Length. */
export async function readStudioJson(request: Request, maxBytes = 64 * 1024): Promise<unknown> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > 1024 * 1024) {
    throw new StudioInputError(500, "잘못된 요청 크기 제한");
  }
  if (request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") {
    throw new StudioInputError(415, "JSON 요청만 허용합니다.");
  }
  const length = request.headers.get("content-length");
  if (length !== null && /^[0-9]+$/.test(length) && Number(length) > maxBytes) {
    throw new StudioInputError(413, "요청 크기를 초과했습니다.");
  }
  if (!request.body) throw new StudioInputError(400, "요청 본문이 없습니다.");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const {done, value} = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) throw new StudioInputError(413, "요청 크기를 초과했습니다.");
      chunks.push(value);
    }
  } catch (error) {
    if (error instanceof StudioInputError) throw error;
    throw new StudioInputError(400, "요청을 읽지 못했습니다.");
  } finally {
    void reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
  if (size === 0) throw new StudioInputError(400, "요청 본문이 없습니다.");
  const bytes = new Uint8Array(size);
  let position = 0;
  for (const chunk of chunks) { bytes.set(chunk, position); position += chunk.byteLength; }
  let json: unknown;
  try {
    json = JSON.parse(new TextDecoder("utf-8", {fatal:true}).decode(bytes));
  } catch {
    throw new StudioInputError(400, "올바른 JSON이 아닙니다.");
  }
  if (json === null || typeof json !== "object" || Array.isArray(json)) {
    throw new StudioInputError(400, "JSON 객체만 허용합니다.");
  }
  return json;
}
