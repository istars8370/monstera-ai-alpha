import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/browser",
  testMatch: "**/*.spec.mjs",
  timeout: 30000,
  expect: { timeout: 7000 },
  retries: 0,
  workers: 1,
  reporter: "list",
  use: {
    baseURL: process.env.MONSTERA_TEST_HTTP_ORIGIN ?? "http://127.0.0.1:3307",
    browserName: "chromium",
    headless: true,
    httpCredentials: {
      username: "ci-alpha",
      password: "ci-only-alpha-password-not-a-real-secret",
    },
    trace: "retain-on-failure",
  },
});
