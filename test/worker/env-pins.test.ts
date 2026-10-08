import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

// Guards against .dev.vars leakage (SPEC 12): every var the tests depend on must hold
// the value pinned in vitest.config.ts, whatever a developer's .dev.vars says.
describe("pinned test bindings", () => {
  const e = env as unknown as Record<string, unknown>;

  it.each([
    ["AUTH_MODE", "dev"],
    ["TRIAGE_PROVIDER", "stub"],
    ["SITE_ID", "hq"],
    ["DEV_ACCESS_ISSUER", "https://placessync-dev.localhost"],
    ["DEV_ACCESS_AUD", "placessync-dev"],
    ["LLM_BASE_URL", "http://127.0.0.1:9/v1"],
    ["LLM_MODEL", "unused-in-tests"],
  ])("%s is pinned to %s", (key, value) => {
    expect(e[key]).toBe(value);
  });

  it("DEV_ACCESS_JWKS is a freshly generated RS256 public key set", () => {
    const jwks = JSON.parse(String(e.DEV_ACCESS_JWKS)) as { keys: { kty: string; alg: string; d?: string }[] };
    expect(jwks.keys).toHaveLength(1);
    expect(jwks.keys[0]?.kty).toBe("RSA");
    expect(jwks.keys[0]?.alg).toBe("RS256");
    expect(jwks.keys[0]?.d).toBeUndefined();
  });

  it("DEV_ACCESS_PRIVATE_JWK is an RSA private key, not the .dev.vars.example placeholder", () => {
    const raw = String(e.DEV_ACCESS_PRIVATE_JWK);
    expect(raw).not.toContain("REPLACE_WITH");
    const jwk = JSON.parse(raw) as { kty: string; d?: string };
    expect(jwk.kty).toBe("RSA");
    expect(jwk.d).toBeTypeOf("string");
  });

  it("TEST_MIGRATIONS is an array", () => {
    expect(Array.isArray(e.TEST_MIGRATIONS)).toBe(true);
  });

  it("no AI binding exists in the local environment", () => {
    expect(e.AI).toBeUndefined();
  });
});
