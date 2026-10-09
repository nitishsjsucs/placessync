import path from "node:path";
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";
import react from "@vitejs/plugin-react";
import { exportJWK, generateKeyPair } from "jose";
import { defineConfig } from "vitest/config";

// A fresh RS256 pair per test run. No key material is committed (SPEC 9.2).
const { publicKey, privateKey } = await generateKeyPair("RS256", { extractable: true });
const publicJwk = { ...(await exportJWK(publicKey)), kid: "test-key", alg: "RS256", use: "sig" };
const privateJwk = { ...(await exportJWK(privateKey)), kid: "test-key", alg: "RS256" };
const migrations = await readD1Migrations(path.join(import.meta.dirname, "migrations"));

// Every var the tests depend on. These beat anything a developer has in .dev.vars,
// which the plugin also loads (SPEC 12). env-pins.test.ts asserts each value.
export const pinned = {
  TEST_MIGRATIONS: migrations,
  AUTH_MODE: "dev",
  TRIAGE_PROVIDER: "stub",
  SITE_ID: "hq",
  DEV_ACCESS_ISSUER: "https://placessync-dev.localhost",
  DEV_ACCESS_AUD: "placessync-dev",
  DEV_ACCESS_JWKS: JSON.stringify({ keys: [publicJwk] }),
  DEV_ACCESS_PRIVATE_JWK: JSON.stringify(privateJwk),
  LLM_BASE_URL: "http://127.0.0.1:9/v1",
  LLM_MODEL: "unused-in-tests",
};

const cf = () =>
  cloudflareTest({
    wrangler: { configPath: "./wrangler.jsonc" },
    remoteBindings: false,
    miniflare: { bindings: pinned },
  });

// On a quiet machine almost every Workers test takes under 200 ms (the few long ones set
// their own timeout). This Mac also runs other builds' test suites: at a load average of
// about 80 on 10 cores, seven of those short HTTP tests passed the default 5 s and failed,
// and a rerun passed. The node project's render-results CLI test (three `node` child
// processes, under 1 s alone) failed the same way at a load average of about 25. A test
// that really hangs still fails, after 30 s. Assertions are unchanged.
const loadedMachineTimeouts = { testTimeout: 30_000, hookTimeout: 30_000 };

export default defineConfig({
  test: {
    passWithNoTests: true,
    projects: [
      {
        plugins: [cf()],
        test: {
          name: "worker",
          ...loadedMachineTimeouts,
          include: ["test/worker/**/*.test.ts"],
          setupFiles: ["./test/apply-migrations.ts"],
        },
      },
      {
        plugins: [cf()],
        test: {
          name: "worker-ws",
          ...loadedMachineTimeouts,
          include: ["test/ws/**/*.test.ts"],
          setupFiles: ["./test/apply-migrations.ts"],
          // WebSockets with Durable Objects are unsupported under per-file storage
          // isolation; Cloudflare recommends one worker and no isolation (SPEC 12).
          maxWorkers: 1,
          isolate: false,
          sequence: { groupOrder: 1 },
        },
      },
      {
        plugins: [react()],
        test: {
          name: "ui",
          environment: "jsdom",
          // Full-page tests drive dozens of user-event steps; on a loaded or battery-powered
          // machine they can pass 5 s, so the timeout is generous. Assertions are unchanged.
          testTimeout: 30_000,
          include: ["test/ui/**/*.test.tsx", "test/ui/**/*.test.ts"],
          setupFiles: ["./test/ui/setup.ts"],
        },
      },
      {
        test: {
          name: "node",
          environment: "node",
          ...loadedMachineTimeouts,
          include: ["test/node/**/*.test.ts"],
        },
      },
    ],
  },
});
