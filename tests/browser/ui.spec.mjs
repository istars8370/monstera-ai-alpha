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
  await expect(page.getByText(/내부 크레딧 가용 잔액: 20/)).toBeVisible();
  await page.getByRole("combobox", { name: "AI 모델" }).selectOption(modelB);
  await page.getByRole("textbox", { name: "메시지" }).fill("hello browser alpha");
  await page.getByRole("button", { name: "전송" }).click();
  await expect(page.getByText("MOCK_REPLY:hello browser alpha")).toBeVisible();
  expect(state.sent).toHaveLength(1);
  expect(state.sent[0]).toMatchObject({ modelId: modelB, expected: alice, actual: alice });
  await page.reload();
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
  expect(stored.some(m => m.content === "MOCK_REPLY:hello browser alpha")).toBe(true);
});

test("switching accounts clears old on-screen history and never submits it as another user", async ({ page, context }) => {
  const state = { user: alice, sent: [] };
  await mockNetwork(context, state);
  await page.goto("/");
  await expect(page.getByRole("combobox", { name: "AI 모델" })).toBeVisible();
  await page.getByRole("textbox", { name: "메시지" }).fill("private Alice history");
  await page.getByRole("button", { name: "전송" }).click();
  await expect(page.getByText("MOCK_REPLY:private Alice history")).toBeVisible();

  state.user = bob;
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(page.getByRole("link", { name: "Google로 로그인" })).toBeVisible();
  await expect(page.getByText("private Alice history")).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole("combobox", { name: "AI 모델" })).toBeVisible();
  await expect(page.getByText("private Alice history")).toHaveCount(0);
  await page.getByRole("textbox", { name: "메시지" }).fill("Bob writes");
  await page.getByRole("button", { name: "전송" }).click();
  await expect(page.getByText("MOCK_REPLY:Bob writes")).toBeVisible();
  expect(state.sent.at(-1)).toMatchObject({ expected: bob, actual: bob });
  expect(state.sent.at(-1).messages.every(m => !m.content.includes("Alice"))).toBe(true);

  state.user = alice;
  await page.reload();
  await expect(page.getByText("MOCK_REPLY:private Alice history")).toBeVisible();
  await expect(page.getByText("Bob writes")).toHaveCount(0);
});

test("logout clears the visible conversation but keeps per-account local history", async ({ page, context }) => {
  const state = { user: alice, sent: [], loginAs: alice };
  await mockNetwork(context, state);
  await page.goto("/");
  await expect(page.getByRole("combobox", { name: "AI 모델" })).toBeVisible();
  await page.getByRole("textbox", { name: "메시지" }).fill("local private record");
  await page.getByRole("button", { name: "전송" }).click();
  await expect(page.getByText("MOCK_REPLY:local private record")).toBeVisible();
  await page.getByRole("button", { name: "로그아웃" }).click();
  await expect(page.getByRole("link", { name: "Google로 로그인" })).toBeVisible();
  await expect(page.getByText("local private record")).toHaveCount(0);
  await page.getByRole("link", { name: "Google로 로그인" }).click();
  await expect(page.getByText("MOCK_REPLY:local private record")).toBeVisible();
});

test("provider failure displays a safe error; cancelled request disables its stream", async ({ page, context }) => {
  const state = { user: alice, sent: [], mode: "unavailable" };
  await mockNetwork(context, state);
  await page.goto("/");
  await expect(page.getByRole("combobox", { name: "AI 모델" })).toBeVisible();
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
  await expect(page.getByRole("status")).toContainText("로컬 기록을 불러올 수 없습니다");
  await page.getByRole("textbox", { name: "메시지" }).fill("no local storage");
  await page.getByRole("button", { name: "전송" }).click();
  await expect(page.getByText("MOCK_REPLY:no local storage")).toBeVisible();
  await expect(page.getByRole("status")).toContainText("로컬 기록 저장 실패");
});


test("switching user midflight aborts old stream before any cross-account reply is saved", async ({ page, context }) => {
  const state = { user: alice, sent: [], mode: "slow" };
  await mockNetwork(context, state);
  await page.goto("/");
  await expect(page.getByRole("combobox", { name: "AI 모델" })).toBeVisible();
  await page.getByRole("textbox", { name: "메시지" }).fill("Alice secret pending");
  await page.getByRole("button", { name: "전송" }).click();
  await expect(page.getByRole("button", { name: "중단" })).toBeEnabled();

  state.user = bob;
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(page.getByRole("link", { name: "Google로 로그인" })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("combobox", { name: "AI 모델" })).toBeVisible();
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
  expect(bobRecords.every(m => !m.content.includes("Alice secret"))).toBe(true);
});


test("shared-device privacy: explicitly purge all account histories after confirmation", async ({ page, context }) => {
  const state = { user: alice, sent: [] };
  await mockNetwork(context, state);
  await page.goto("/");
  await expect(page.getByRole("combobox", { name: "AI 모델" })).toBeVisible();
  await page.getByRole("textbox", { name: "메시지" }).fill("Alice local privacy");
  await page.getByRole("button", { name: "전송" }).click();
  await expect(page.getByText("MOCK_REPLY:Alice local privacy")).toBeVisible();
  state.user = bob;
  await page.reload();
  await expect(page.getByRole("combobox", { name: "AI 모델" })).toBeVisible();
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
  state.user = alice;
  await page.reload();
  await expect(page.getByText("Alice local privacy")).toHaveCount(0);
});


test("privacy: deleting current account history removes only its IndexedDB record", async ({ page, context }) => {
  const state = { user: alice, sent: [] };
  await mockNetwork(context, state);
  await page.goto("/");
  await expect(page.getByRole("combobox", { name: "AI 모델" })).toBeVisible();
  await page.getByRole("textbox", { name: "메시지" }).fill("Alice must remain");
  await page.getByRole("button", { name: "전송" }).click();
  await expect(page.getByText("MOCK_REPLY:Alice must remain")).toBeVisible();

  state.user = bob;
  await page.reload();
  await expect(page.getByRole("combobox", { name: "AI 모델" })).toBeVisible();
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
  await expect(page.getByText("MOCK_REPLY:Alice must remain")).toBeVisible();
});
