// Optional browser QA: supply PLAYWRIGHT_MODULE or install Playwright in the QA environment.
// Start `pnpm demo --production` after a build; only fictional text and loopback Mock data.
import assert from "node:assert/strict";
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE, args: ["--no-sandbox"] });
try {
  const context = await browser.newContext({ httpCredentials: { username: "demo", password: "demo-local-only" }, viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  const errors = []; page.on("pageerror", error => errors.push(error.message));
  const external = []; page.on("request", request => { if (!request.url().startsWith("http://127.0.0.1:3000")) external.push(request.url()); });
  await page.goto("http://127.0.0.1:3000");
  await page.waitForFunction(() => document.querySelector("select")?.options.length === 2);
  // Seed a legacy plaintext record to prove the app neither auto-loads nor removes it.
  await page.evaluate(() => new Promise((resolve, reject) => {
    const req = indexedDB.open("monstera-alpha-local", 1);
    req.onupgradeneeded = () => req.result.createObjectStore("chat");
    req.onsuccess = () => { const db = req.result, tx = db.transaction("chat", "readwrite"); tx.objectStore("chat").put([{ role: "user", content: "LEGACY_KEEP_FICTIONAL" }], "messages"); tx.oncomplete = () => { db.close(); resolve(); }; tx.onerror = reject; };
    req.onerror = reject;
  }));
  await page.reload(); await page.waitForFunction(() => document.querySelector("select")?.options.length === 2);
  assert.equal(await page.getByText("LEGACY_KEEP_FICTIONAL", { exact: true }).count(), 0);
  await page.getByLabel("모델", { exact: true }).selectOption("demo-private-2");
  await page.getByLabel("메시지", { exact: true }).fill("FICTIONAL_BROWSER_PROMPT");
  const received = page.waitForResponse(r => r.url().endsWith("/api/chat") && r.request().method() === "POST");
  const sent = page.waitForRequest(r => r.url().endsWith("/api/chat") && r.method() === "POST");
  await page.getByRole("button", { name: "전송", exact: true }).click();
  assert.equal((await sent).postDataJSON().model, "demo-private-2");
  const response = await received;
  assert.equal(response.status(), 200, "CHAT_HTTP_STATUS");
  await page.waitForFunction(() => document.querySelector("section[aria-label='대화']")?.textContent.includes("오프라인 Mock"));
  await page.waitForFunction(() => [...document.querySelectorAll("button")].some(button => button.textContent === "전송" && !button.disabled));
  assert.match(await page.locator("section[aria-label='대화']").innerText(), /오프라인 Mock/);
  assert.equal(await page.getByRole("status").count(), 0, "STREAM_MUST_COMPLETE_WITHOUT_ERROR_NOTICE");
  // Force a browser-side network error; no hidden vendor request or success UI.
  await page.route("**/api/chat", route => route.abort("failed"));
  await page.getByLabel("메시지", { exact: true }).fill("FICTIONAL_NETWORK_FAILURE");
  await page.getByRole("button", { name: "전송", exact: true }).click();
  await page.getByRole("status").filter({ hasText: "응답 오류" }).waitFor();
  await page.unroute("**/api/chat");
  await page.getByLabel("메시지", { exact: true }).fill("FICTIONAL_CANCEL");
  await page.getByRole("button", { name: "전송", exact: true }).click();
  await page.getByRole("button", { name: "중단", exact: true }).click();
  await page.getByRole("status").filter({ hasText: "중단" }).waitFor();
  await page.getByRole("button", { name: "현재 대화 비우기", exact: true }).click();
  assert.equal(await page.locator("article").count(), 0);
  // The legacy record survives sending, cancel, clear and refresh.
  const legacy = await page.evaluate(() => new Promise((resolve, reject) => {
    const req = indexedDB.open("monstera-alpha-local", 1);
    req.onsuccess = () => { const db = req.result, get = db.transaction("chat").objectStore("chat").get("messages"); get.onsuccess = () => { db.close(); resolve(get.result); }; get.onerror = reject; }; req.onerror = reject;
  }));
  assert.equal(legacy[0].content, "LEGACY_KEEP_FICTIONAL");
  assert.equal(await page.evaluate(() => localStorage.length + sessionStorage.length), 0);
  await page.getByLabel("메시지", { exact: true }).fill("FICTIONAL_REFRESH");
  await page.getByRole("button", { name: "전송", exact: true }).click();
  await page.waitForFunction(() => [...document.querySelectorAll("button")].some(button => button.textContent === "전송" && !button.disabled));
  await page.reload(); await page.waitForFunction(() => document.querySelector("select")?.options.length === 2);
  assert.equal(await page.locator("article").count(), 0);
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), false);
  if (process.env.PRIVACY_QA_SCREENSHOT) await page.screenshot({ path: process.env.PRIVACY_QA_SCREENSHOT, fullPage: true });
  assert.deepEqual(errors, []); assert.deepEqual(external, []);
  const body = await page.content(); assert.doesNotMatch(body, /offline-dummy-key/);
  await context.close();
  console.log("PASS: model selection, streaming, browser network failure, cancel, clear, refresh, legacy preservation, no web storage writes, mobile overflow, no external browser requests, no key/page errors");
} finally { await browser.close(); }
