import { defineConfig, devices } from "@playwright/test";

const port = Number(process.env.E2E_PORT || 43917);
const baseURL = `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: process.env.CI ? [["line"], ["html", { open: "never" }]] : "line",
  timeout: 45_000,
  expect: {
    timeout: 10_000
  },
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure"
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] }
    }
  ],
  webServer: {
    command: "node scripts/dev-server.mjs",
    env: {
      HOST: "127.0.0.1",
      PORT: String(port)
    },
    url: baseURL,
    reuseExistingServer: false,
    timeout: 120_000
  }
});
