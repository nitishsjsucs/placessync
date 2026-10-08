import { defineConfig, devices } from "@playwright/test";

// e2e runs against `npm run preview` (local workerd via the Vite plugin) on port 8783.
// In CI the job starts the server itself and Playwright reuses it (SPEC 12.4, 18).
export default defineConfig({
  testDir: "./e2e",
  testMatch: "**/*.spec.ts",
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  globalSetup: "./e2e/global-setup.ts",
  reporter: [["list"], ["html", { open: "never" }], ["./e2e/results-reporter.ts", { out: "evals/results/e2e.json" }]],
  use: {
    baseURL: "http://localhost:8783",
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "npm run preview",
    url: "http://localhost:8783/api/health",
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
