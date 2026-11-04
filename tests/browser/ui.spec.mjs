import { test, expect } from "@playwright/test";

const alice = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const bob = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const modelA = "11111111-1111-4111-8111-111111111111";
const modelB = "22222222-2222-4222-8222-222222222222";
const models = [
  { id: modelA, label: "Mock Text", provider: "openrouter", context: 4096 },
  { id: modelB, label: "Mock Creative", provider: "deepinfra", context: 4096 },
];
const baseURL = process.env.MONSTERA_TEST_HTTP_ORIGIN ?? "http://127.0.0.1:3307";


const testingPassphrase = "isolated-test-passphrase-12345";
async function unlock(page) {
  await page.getByLabel("로컬 기록 암호").fill(testingPassphrase);
  await page.getByRole("button", { name: "잠금 해제" }).click();
  await expect(page.getByText("로컬 기록 잠금 해제됨")).toBeVisible();
}

function fakeStream(text) {
  return [
    "event: delta",
    "data: " + JSON.stringify({ text }),
    "",
    "event: done",
    "data: {}",
    "",
    "",
  ].join("\n");
}
async function mockNetwork(context, state) {
  // The browser exercises the real React UI and local IndexedDB, while every
  // external system (OAuth, DB identity, Redis and AI providers) is mocked.
  // Tests never authenticate at Google or spend real provider credits.
  await context.route("https://**/*", route => route.abort("blockedbyclient"));
  await context.route("**/api/models", route => {
    if (!state.user) return route.fulfill({ status: 401, json: { code: "UNAUTHORIZED" } });
    return route.fulfill({
      status: 200, json: { userId: state.user, models: state.user === bob ? [...models].reverse() : models },
    });
  });
  await context.route("**/api/credits", route => route.fulfill({
    status: state.user ? 200 : 401,
    json: state.user ? { balance: 20, reserved: 0, available: 20 } : { code: "UNAUTHORIZED" },
  }));
  await context.route("**/api/auth/google", route => {
    state.user = state.loginAs ?? alice;
    return route.fulfill({
      status: 302, headers: { location: baseURL + "/" }, body: "",
    });
  });
  await context.route("**/api/auth/logout", route => {
    state.user = null;
    return route.fulfill({ status: 200, json: { status: "signed_out" } });
  });
  await context.route("**/api/chat", async route => {
    const data = route.request().postDataJSON();
    state.sent.push({
      modelId: data.modelId,
      messages: data.messages,
      expected: route.request().headers()["x-monstera-expected-user"],
      actual: state.user,
    });
    if (state.mode === "unavailable") {
      return route.fulfill({ status: 503, json: { code: "CHAT_UNAVAILABLE" } });
    }
    if (state.mode === "slow") {
      await new Promise(resolve => setTimeout(resolve, 1800));
    }
    try {
      return await route.fulfill({
        status: 200,
        contentType: "text/event-stream; charset=utf-8",
        headers: { "cache-control": "no-store" },
        body: fakeStream("MOCK_REPLY:" + String(data.messages.at(-1).content)),
      });
    } catch { /* Client cancelled while mock HTTP request was pending. */ }
  });
}

test("new login, model selection, streaming chat and IndexedDB persistence", async ({ page, context }) => {
  const state = { user: null, sent: [], loginAs: alice };
  await mockNetwork(context, state);
  await page.goto("/");
  await expect(page.getByRole("link", { name: "Google로 로그인" })).toBeVisible();
  await page.getByRole("link", { name: "Google로 로그인" }).click();
  await expect(page.getByRole("combobox", { name: "AI 모델" })).toBeVisible();
  await unlock(page);
  await expect(page.getByText(/내부 크레딧 가용 잔액: 20/)).toBeVisible();
  await page.getByRole("combobox", { name: "AI 모델" }).selectOption(modelB);
  await page.getByRole("textbox", { name: "메시지" }).fill("hello browser alpha");
  await page.getByRole("button", { name: "전송" }).click();
  await expect(page.getByText("MOCK_REPLY:hello browser alpha")).toBeVisible();
  expect(state.sent).toHaveLength(1);
  expect(state.sent[0]).toMatchObject({ modelId: modelB, expected: alice, actual: alice });
  await page.reload();
  await expect(page.getByRole("combobox", { name: "AI 모델" })).toBeVisible();
  await unlock(page);
  await expect(page.getByText("MOCK_REPLY:hello browser alpha")).toBeVisible();
  const stored = await page.evaluate(userId => new Promise((resolve, reject) => {
    const open = indexedDB.open("monstera-alpha-local");
    open.onsuccess = () => {
      const db = open.result;
      const tx = db.transaction("chat", "readonly");
      const get = tx.objectStore("chat").get("messages:" + userId);
      get.onsuccess = () => { db.close(); resolve(get.result); };
      get.onerror = () => reject(get.error);
    };
    open.onerror = () => reject(open.error);
  }), alice);
  expect(stored.v).toBe(2);
  expect(stored.nonce.length).toBe(24);
  expect(stored.ciphertext.length).toBeGreaterThan(16);
  expect(JSON.stringify(stored)).not.toContain("MOCK_REPLY:hello browser alpha");
});

test("switching accounts clears old on-screen history and never submits it as another user", async ({ page, context }) => {
  const state = { user: alice, sent: [] };
  await mockNetwork(context, state);
  await page.goto("/");
  await expect(page.getByRole("combobox", { name: "AI 모델" })).toBeVisible();
  await unlock(page);
  await page.getByRole("textbox", { name: "메시지" }).fill("private Alice history");
  await page.getByRole("button", { name: "전송" }).click();
  await expect(page.getByText("MOCK_REPLY:private Alice history")).toBeVisible();

  state.user = bob;
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(page.getByRole("link", { name: "Google로 로그인" })).toBeVisible();
  await expect(page.getByText("private Alice history")).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole("combobox", { name: "AI 모델" })).toBeVisible();
  await unlock(page);
  await expect(page.getByText("private Alice history")).toHaveCount(0);
  await page.getByRole("textbox", { name: "메시지" }).fill("Bob writes");
  await page.getByRole("button", { name: "전송" }).click();
  await expect(page.getByText("MOCK_REPLY:Bob writes")).toBeVisible();
  expect(state.sent.at(-1)).toMatchObject({ expected: bob, actual: bob });
  expect(state.sent.at(-1).messages.every(m => !m.content.includes("Alice"))).toBe(true);

  state.user = alice;
  await page.reload();
  await expect(page.getByRole("combobox", { name: "AI 모델" })).toBeVisible();
  await unlock(page);
  await expect(page.getByText("MOCK_REPLY:private Alice history")).toBeVisible();
  await expect(page.getByText("Bob writes")).toHaveCount(0);
});

test("logout clears the visible conversation but keeps per-account local history", async ({ page, context }) => {
  const state = { user: alice, sent: [], loginAs: alice };
  await mockNetwork(context, state);
  await page.goto("/");
  await expect(page.getByRole("combobox", { name: "AI 모델" })).toBeVisible();
  await unlock(page);
  await page.getByRole("textbox", { name: "메시지" }).fill("local private record");
  await page.getByRole("button", { name: "전송" }).click();
  await expect(page.getByText("MOCK_REPLY:local private record")).toBeVisible();
  await page.getByRole("button", { name: "로그아웃" }).click();
  await expect(page.getByRole("link", { name: "Google로 로그인" })).toBeVisible();
  await expect(page.getByText("local private record")).toHaveCount(0);
  await page.getByRole("link", { name: "Google로 로그인" }).click();
  await expect(page.getByRole("combobox", { name: "AI 모델" })).toBeVisible();
  await unlock(page);
  await expect(page.getByText("MOCK_REPLY:local private record")).toBeVisible();
});

test("provider failure displays a safe error; cancelled request disables its stream", async ({ page, context }) => {
  const state = { user: alice, sent: [], mode: "unavailable" };
  await mockNetwork(context, state);
  await page.goto("/");
  await expect(page.getByRole("combobox", { name: "AI 모델" })).toBeVisible();
  await unlock(page);
  await page.getByRole("textbox", { name: "메시지" }).fill("expected failure");
  await page.getByRole("button", { name: "전송" }).click();
  await expect(page.getByRole("status")).toContainText("CHAT_UNAVAILABLE");
  state.mode = "slow";
  await page.getByRole("textbox", { name: "메시지" }).fill("please stop");
  await page.getByRole("button", { name: "전송" }).click();
  await expect(page.getByRole("button", { name: "중단" })).toBeEnabled();
  await page.getByRole("button", { name: "중단" }).click();
  await expect(page.getByRole("status")).toContainText("응답을 중단했습니다");
  await expect(page.getByRole("button", { name: "전송" })).toBeDisabled();
});

test("IndexedDB unavailability is handled without revealing other users' stored data", async ({ page, context }) => {
  const state = { user: alice, sent: [] };
  await mockNetwork(context, state);
  await page.addInitScript(() => {
    Object.defineProperty(window, "indexedDB", { configurable: true, get() { throw new Error("DISABLED"); } });
  });
  await page.goto("/");
  await expect(page.getByRole("combobox", { name: "AI 모델" })).toBeVisible();
  await page.getByLabel("로컬 기록 암호").fill(testingPassphrase);
  await page.getByRole("button", { name: "잠금 해제" }).click();
  await expect(page.getByRole("status")).toContainText("로컬 잠금 해제 실패");
  await page.getByRole("textbox", { name: "메시지" }).fill("no local storage");
  await page.getByRole("button", { name: "전송" }).click();
  await expect(page.getByText("MOCK_REPLY:no local storage")).toBeVisible();
  await expect(page.getByRole("status")).toContainText("기록이 잠겨 있어 저장하지 않았습니다");
});


test("switching user midflight aborts old stream before any cross-account reply is saved", async ({ page, context }) => {
  const state = { user: alice, sent: [], mode: "slow" };
  await mockNetwork(context, state);
  await page.goto("/");
  await expect(page.getByRole("combobox", { name: "AI 모델" })).toBeVisible();
  await unlock(page);
  await page.getByRole("textbox", { name: "메시지" }).fill("Alice secret pending");
  await page.getByRole("button", { name: "전송" }).click();
  await expect(page.getByRole("button", { name: "중단" })).toBeEnabled();

  state.user = bob;
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(page.getByRole("link", { name: "Google로 로그인" })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("combobox", { name: "AI 모델" })).toBeVisible();
  await unlock(page);
  await expect(page.getByText("Alice secret pending")).toHaveCount(0);
  const bobRecords = await page.evaluate(userId => new Promise((resolve, reject) => {
    const open = indexedDB.open("monstera-alpha-local");
    open.onsuccess = () => {
      const db = open.result;
      const request = db.transaction("chat", "readonly").objectStore("chat").get("messages:" + userId);
      request.onsuccess = () => { db.close(); resolve(request.result ?? []); };
      request.onerror = () => reject(request.error);
    };
    open.onerror = () => reject(open.error);
  }), bob);
  expect(JSON.stringify(bobRecords)).not.toContain("Alice secret");
});


test("shared-device privacy: explicitly purge all account histories after confirmation", async ({ page, context }) => {
  const state = { user: alice, sent: [] };
  await mockNetwork(context, state);
  await page.goto("/");
  await expect(page.getByRole("combobox", { name: "AI 모델" })).toBeVisible();
  await unlock(page);
  await page.getByRole("textbox", { name: "메시지" }).fill("Alice local privacy");
  await page.getByRole("button", { name: "전송" }).click();
  await expect(page.getByText("MOCK_REPLY:Alice local privacy")).toBeVisible();
  state.user = bob;
  await page.reload();
  await expect(page.getByRole("combobox", { name: "AI 모델" })).toBeVisible();
  await unlock(page);
  await page.getByRole("textbox", { name: "메시지" }).fill("Bob local privacy");
  await page.getByRole("button", { name: "전송" }).click();
  await expect(page.getByText("MOCK_REPLY:Bob local privacy")).toBeVisible();

  page.once("dialog", dialog => dialog.dismiss());
  await page.getByRole("button", { name: "이 기기 모든 기록 삭제" }).click();
  await expect(page.getByText("MOCK_REPLY:Bob local privacy")).toBeVisible();

  page.once("dialog", dialog => dialog.accept());
  await page.getByRole("button", { name: "이 기기 모든 기록 삭제" }).click();
  await expect(page.getByRole("status")).toContainText("모든 계정 대화 기록을 삭제했습니다");
  await expect(page.getByText("Bob local privacy")).toHaveCount(0);
  const count = await page.evaluate(() => new Promise((resolve, reject) => {
    const open = indexedDB.open("monstera-alpha-local");
    open.onsuccess = () => {
      const db = open.result;
      const request = db.transaction("chat", "readonly").objectStore("chat").count();
      request.onsuccess = () => { db.close(); resolve(request.result); };
      request.onerror = () => reject(request.error);
    };
    open.onerror = () => reject(open.error);
  }));
  expect(count).toBe(0);
  const saltCount = await page.evaluate(() => new Promise((resolve, reject) => {
    const open = indexedDB.open("monstera-alpha-local");
    open.onsuccess = () => {
      const db = open.result;
      const count = db.transaction("meta", "readonly").objectStore("meta").count();
      count.onsuccess = () => { db.close(); resolve(count.result); };
      count.onerror = () => reject(count.error);
    };
    open.onerror = () => reject(open.error);
  }));
  expect(saltCount).toBe(0);
  state.user = alice;
  await page.reload();
  await expect(page.getByText("Alice local privacy")).toHaveCount(0);
});


test("privacy: deleting current account history removes only its IndexedDB record", async ({ page, context }) => {
  const state = { user: alice, sent: [] };
  await mockNetwork(context, state);
  await page.goto("/");
  await expect(page.getByRole("combobox", { name: "AI 모델" })).toBeVisible();
  await unlock(page);
  await page.getByRole("textbox", { name: "메시지" }).fill("Alice must remain");
  await page.getByRole("button", { name: "전송" }).click();
  await expect(page.getByText("MOCK_REPLY:Alice must remain")).toBeVisible();

  state.user = bob;
  await page.reload();
  await expect(page.getByRole("combobox", { name: "AI 모델" })).toBeVisible();
  await unlock(page);
  await page.getByRole("textbox", { name: "메시지" }).fill("Bob must disappear");
  await page.getByRole("button", { name: "전송" }).click();
  await expect(page.getByText("MOCK_REPLY:Bob must disappear")).toBeVisible();

  const deleteCurrent = page.getByRole("button", { name: "현재 계정 기록 삭제" });
  page.once("dialog", dialog => dialog.dismiss());
  await deleteCurrent.click();
  await expect(page.getByText("MOCK_REPLY:Bob must disappear")).toBeVisible();

  page.once("dialog", dialog => dialog.accept());
  await deleteCurrent.click();
  await expect(page.getByRole("status")).toContainText("현재 계정의 이 기기 대화 기록을 삭제했습니다");
  await expect(page.getByText("Bob must disappear")).toHaveCount(0);

  const records = await page.evaluate(() => new Promise((resolve, reject) => {
    const request = indexedDB.open("monstera-alpha-local");
    request.onsuccess = () => {
      const db = request.result;
      const transaction = db.transaction("chat", "readonly");
      const store = transaction.objectStore("chat");
      const keys = store.getAllKeys();
      keys.onsuccess = () => { db.close(); resolve(keys.result); };
      keys.onerror = () => reject(keys.error);
    };
    request.onerror = () => reject(request.error);
  }));
  expect(records).toContain("messages:" + alice);
  expect(records).not.toContain("messages:" + bob);
  state.user = alice;
  await page.reload();
  await expect(page.getByRole("combobox", { name: "AI 모델" })).toBeVisible();
  await unlock(page);
  await expect(page.getByText("MOCK_REPLY:Alice must remain")).toBeVisible();
});


test("privacy: switching accounts and logout discard the previous user's unsent draft", async ({ page, context }) => {
  const state = { user: alice, sent: [] };
  await mockNetwork(context, state);
  await page.goto("/");
  await expect(page.getByRole("combobox", { name: "AI 모델" })).toBeVisible();
  await unlock(page);
  await page.getByRole("textbox", { name: "메시지" }).fill("Alice unsent confidential draft");

  state.user = bob;
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(page.getByRole("link", { name: "Google로 로그인" })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "메시지" })).toHaveValue("");
  await page.reload();
  await expect(page.getByRole("combobox", { name: "AI 모델" })).toBeVisible();
  await unlock(page);
  await expect(page.getByRole("textbox", { name: "메시지" })).toHaveValue("");

  await page.getByRole("textbox", { name: "메시지" }).fill("Bob unsent draft");
  await page.getByRole("button", { name: "로그아웃" }).click();
  await expect(page.getByRole("link", { name: "Google로 로그인" })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "메시지" })).toHaveValue("");
});


test("legacy plaintext is preserved while locked, then migrated to encrypted v2 on unlock", async ({ page, context }) => {
  const state = { user: alice, sent: [] };
  await mockNetwork(context, state);
  await page.goto("/");
  await expect(page.getByRole("combobox", { name: "AI 모델" })).toBeVisible();
  const legacy = [{ role: "user", content: "old local private text" }];
  await page.evaluate(({ account, records }) => new Promise((resolve, reject) => {
    const request = indexedDB.open("monstera-alpha-local", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("chat");
    request.onsuccess = () => {
      const db = request.result;
      const tx = db.transaction("chat", "readwrite");
      tx.objectStore("chat").put(records, "messages:" + account);
      tx.oncomplete = () => { db.close(); resolve(null); };
      tx.onerror = () => { db.close(); reject(tx.error); };
    };
    request.onerror = () => reject(request.error);
  }), { account: alice, records: legacy });
  // 잠긴 상태에서 채팅을 전송해도 기존 평문 레코드를 덮어쓰지 않는다.
  await page.getByRole("textbox", { name: "메시지" }).fill("not persisted while locked");
  await page.getByRole("button", { name: "전송" }).click();
  await expect(page.getByText("MOCK_REPLY:not persisted while locked")).toBeVisible();
  const before = await page.evaluate(account => new Promise((resolve, reject) => {
    const request = indexedDB.open("monstera-alpha-local", 1);
    request.onsuccess = () => {
      const db = request.result;
      const get = db.transaction("chat", "readonly").objectStore("chat").get("messages:" + account);
      get.onsuccess = () => { db.close(); resolve(get.result); };
      get.onerror = () => reject(get.error);
    };
    request.onerror = () => reject(request.error);
  }), alice);
  expect(before).toEqual(legacy);
  await unlock(page);
  await expect(page.getByText("old local private text")).toBeVisible();
  await expect(page.getByRole("status")).toContainText("기존 평문 기록 1개를 암호화했습니다");
  const encrypted = await page.evaluate(account => new Promise((resolve, reject) => {
    const request = indexedDB.open("monstera-alpha-local", 2);
    request.onsuccess = () => {
      const db = request.result;
      const get = db.transaction("chat", "readonly").objectStore("chat").get("messages:" + account);
      get.onsuccess = () => { db.close(); resolve(get.result); };
      get.onerror = () => reject(get.error);
    };
    request.onerror = () => reject(request.error);
  }), alice);
  expect(encrypted.v).toBe(2);
  expect(encrypted.nonce.length).toBe(24);
  expect(JSON.stringify(encrypted)).not.toContain("old local private text");
  await page.reload();
  await expect(page.getByRole("combobox", { name: "AI 모델" })).toBeVisible();
  await unlock(page);
  await expect(page.getByText("old local private text")).toBeVisible();
});
