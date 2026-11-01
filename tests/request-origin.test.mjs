import test from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server.js";
import { trustedOrigin } from "../lib/request-origin.ts";

test("reverse-proxy-safe CSRF check uses configured origin, not internal origin", () => {
  const original = process.env.MONSTERA_PUBLIC_ORIGIN;
  try {
    process.env.MONSTERA_PUBLIC_ORIGIN = "https://app.example";
    const correct = new NextRequest("http://127.0.0.1:3000/api/chat",
      { headers: { origin: "https://app.example" } });
    const foreign = new NextRequest("http://127.0.0.1:3000/api/chat",
      { headers: { origin: "https://attacker.example" } });
    const absent = new NextRequest("http://127.0.0.1:3000/api/chat");
    assert.equal(trustedOrigin(correct), true);
    assert.equal(trustedOrigin(foreign), false);
    assert.equal(trustedOrigin(absent), true);
    assert.equal(trustedOrigin(absent, true), false);
    process.env.MONSTERA_PUBLIC_ORIGIN = "javascript:alert(1)";
    assert.equal(trustedOrigin(correct), false);
  } finally {
    if (original === undefined) delete process.env.MONSTERA_PUBLIC_ORIGIN;
    else process.env.MONSTERA_PUBLIC_ORIGIN = original;
  }
});
