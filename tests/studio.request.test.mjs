import test from "node:test";
import assert from "node:assert/strict";
import { readStudioJson } from "../lib/studio/request.ts";

function request(body, headers = {}) {
  return new Request("http://localhost/api/studio/quote", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body,
    duplex: "half",
  });
}
test("studio JSON reader accepts valid UTF-8 object", async () => {
  assert.deepEqual(await readStudioJson(request('{"name":"한글"}')), { name:"한글" });
});
test("studio JSON reader enforces actual bytes independently of Content-Length", async () => {
  await assert.rejects(readStudioJson(request(JSON.stringify({data:"x".repeat(100)})), 32), {status:413});
  await assert.rejects(readStudioJson(request("{}", {"content-length":"300"}), 16), {status:413});
});
test("studio JSON reader rejects unsupported and malformed input", async () => {
  await assert.rejects(readStudioJson(request("{}",
    {"content-type":"text/plain"})), {status:415});
  await assert.rejects(readStudioJson(request("{broken")), {status:400});
  await assert.rejects(readStudioJson(request("null")), {status:400});
  await assert.rejects(readStudioJson(request("[]")), {status:400});
  await assert.rejects(readStudioJson(request("")), {status:400});
});
test("studio JSON reader rejects invalid UTF-8", async () => {
  const invalid = new Uint8Array([0xff,0xfe]);
  await assert.rejects(readStudioJson(request(invalid)), {status:400});
});
