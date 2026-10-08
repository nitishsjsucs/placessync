import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { parseConfig } from "../../src/worker/config.ts";

const accessEnv = {
  AUTH_MODE: "access",
  SITE_ID: "hq",
  TRIAGE_PROVIDER: "workers-ai",
  ACCESS_TEAM_DOMAIN: "https://team.cloudflareaccess.com",
  ACCESS_AUD: "aud-test",
};
const devEnv = {
  AUTH_MODE: "dev",
  SITE_ID: "hq",
  TRIAGE_PROVIDER: "stub",
  DEV_ACCESS_ISSUER: "https://placessync-dev.localhost",
  DEV_ACCESS_AUD: "placessync-dev",
  DEV_ACCESS_JWKS: env.DEV_ACCESS_JWKS,
  DEV_ACCESS_PRIVATE_JWK: env.DEV_ACCESS_PRIVATE_JWK,
};

describe("parseConfig (SPEC 7.4)", () => {
  it("accepts a configured access deployment and derives the certs URL", () => {
    const r = parseConfig(accessEnv);
    expect(r.ok).toBe(true);
    if (r.ok && r.config.auth.mode === "access") {
      expect(r.config.auth.jwksUrl).toBe("https://team.cloudflareaccess.com/cdn-cgi/access/certs");
      expect(r.config.auth.issuer).toBe("https://team.cloudflareaccess.com");
    }
  });

  it("accepts the pinned dev config", () => {
    expect(parseConfig(devEnv).ok).toBe(true);
    expect(parseConfig(env as unknown as Record<string, unknown>).ok).toBe(true);
  });

  it.each([
    ["SET_ME team domain", { ...accessEnv, ACCESS_TEAM_DOMAIN: "https://SET_ME.cloudflareaccess.com" }],
    ["SET_ME AUD", { ...accessEnv, ACCESS_AUD: "SET_ME" }],
    ["empty AUD", { ...accessEnv, ACCESS_AUD: "" }],
    ["missing AUD", { ...accessEnv, ACCESS_AUD: undefined }],
    ["empty team domain", { ...accessEnv, ACCESS_TEAM_DOMAIN: "" }],
    ["non-Access host", { ...accessEnv, ACCESS_TEAM_DOMAIN: "https://evil.example.com" }],
    ["http team domain", { ...accessEnv, ACCESS_TEAM_DOMAIN: "http://team.cloudflareaccess.com" }],
    ["unknown AUTH_MODE", { ...accessEnv, AUTH_MODE: "none" }],
    ["unknown TRIAGE_PROVIDER", { ...devEnv, TRIAGE_PROVIDER: "gpt" }],
    ["placeholder JWKS", { ...devEnv, DEV_ACCESS_JWKS: "REPLACE_WITH_npm_run_setup_dev" }],
    ["placeholder private JWK", { ...devEnv, DEV_ACCESS_PRIVATE_JWK: "REPLACE_WITH_npm_run_setup_dev" }],
    ["JWKS without keys", { ...devEnv, DEV_ACCESS_JWKS: '{"keys":[]}' }],
    ["bad SITE_ID", { ...devEnv, SITE_ID: "../evil" }],
  ])("rejects %s", (_name, e) => {
    const r = parseConfig(e as Record<string, unknown>);
    expect(r.ok).toBe(false);
  });
});
