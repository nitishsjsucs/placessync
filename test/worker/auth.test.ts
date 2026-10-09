import { createExecutionContext, listDurableObjectIds, waitOnExecutionContext } from "cloudflare:test";
import { env, exports } from "cloudflare:workers";
import { SignJWT, UnsecuredJWT, exportJWK, generateKeyPair } from "jose";
import { beforeAll, describe, expect, it } from "vitest";
import { createApp, defaultDeps } from "../../src/worker/app.ts";
import { makeVerifierFactory } from "../../src/worker/auth/access-verifier.ts";
import { signDevToken } from "../../src/worker/auth/dev-tokens.ts";
import { fakeJwksFetch } from "../helpers/fake-fetch.ts";
import { ADMIN, EMPLOYEE, authHeaders, emailOf, tokenFor } from "../helpers/tokens.ts";
import { BASE, call, json, seed } from "../helpers/world.ts";

beforeAll(async () => {
  await seed();
});

const me = (headers: Record<string, string>) => call("/api/me", { headers });

describe("dev-mode token verification", () => {
  it("accepts a valid dev token and returns the D1 employee", async () => {
    const res = await me(authHeaders(await tokenFor(EMPLOYEE)));
    expect(res.status).toBe(200);
    const body = await json<{ employee: { id: string; role: string } }>(res);
    expect(body.employee).toMatchObject({ id: EMPLOYEE, role: "employee", email: emailOf(EMPLOYEE) });
  });

  it("rejects a missing token with 401", async () => {
    const res = await me({});
    expect(res.status).toBe(401);
    expect((await json(res)).error).toBe("unauthenticated");
  });

  it("rejects an expired token (beyond the 30 s tolerance)", async () => {
    const token = await tokenFor(EMPLOYEE, { nowMs: Date.now() - 2 * 3600_000, ttlSeconds: 3600 });
    const res = await me(authHeaders(token));
    expect(res.status).toBe(401);
    expect((await json(res)).error).toBe("invalid_token");
  });

  it("rejects a wrong audience", async () => {
    const res = await me(authHeaders(await tokenFor(EMPLOYEE, { audience: "someone-else" })));
    expect(res.status).toBe(401);
    await res.body?.cancel();
  });

  it("rejects a wrong issuer", async () => {
    const res = await me(authHeaders(await tokenFor(EMPLOYEE, { issuer: "https://evil.localhost" })));
    expect(res.status).toBe(401);
    await res.body?.cancel();
  });

  it("rejects a token signed by a different RS256 key", async () => {
    const { privateKey } = await generateKeyPair("RS256", { extractable: true });
    const jwk = { ...(await exportJWK(privateKey)), kid: "test-key" };
    const res = await me(authHeaders(await tokenFor(EMPLOYEE, { privateJwk: JSON.stringify(jwk) })));
    expect(res.status).toBe(401);
    await res.body?.cancel();
  });

  it("rejects alg none", async () => {
    const token = new UnsecuredJWT({ email: emailOf(EMPLOYEE) })
      .setIssuer(env.DEV_ACCESS_ISSUER ?? "")
      .setAudience(env.DEV_ACCESS_AUD ?? "")
      .setIssuedAt()
      .setExpirationTime("1h")
      .encode();
    const res = await me(authHeaders(token));
    expect(res.status).toBe(401);
    await res.body?.cancel();
  });

  it("rejects an HS256-signed token", async () => {
    const token = await new SignJWT({ email: emailOf(EMPLOYEE) })
      .setProtectedHeader({ alg: "HS256", kid: "test-key" })
      .setIssuer(env.DEV_ACCESS_ISSUER ?? "")
      .setAudience(env.DEV_ACCESS_AUD ?? "")
      .setIssuedAt()
      .setExpirationTime("1h")
      .sign(new TextEncoder().encode("a-shared-secret-that-is-long-enough-123456"));
    const res = await me(authHeaders(token));
    expect(res.status).toBe(401);
    await res.body?.cancel();
  });

  it("rejects an unknown email with 403 unknown_user", async () => {
    const res = await me(authHeaders(await tokenFor(EMPLOYEE, { email: "nobody@placessync.test" })));
    expect(res.status).toBe(403);
    expect((await json(res)).error).toBe("unknown_user");
  });

  it("ignores a role claim in the token", async () => {
    const token = await tokenFor(EMPLOYEE, { extraClaims: { role: "facilities_admin" } });
    const res = await me(authHeaders(token));
    expect((await json<{ employee: { role: string } }>(res)).employee.role).toBe("employee");
    const admin = await call("/api/admin/projection/status", { headers: authHeaders(token) });
    expect(admin.status).not.toBe(200);
    await admin.body?.cancel();
  });

  it("accepts the CF_Authorization cookie set by /api/dev/login", async () => {
    const login = await call("/api/dev/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ employeeId: ADMIN }),
    });
    expect(login.status).toBe(200);
    const cookie = login.headers.get("set-cookie") ?? "";
    expect(cookie).toMatch(/^CF_Authorization=/);
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Strict");
    expect(cookie).toContain("Max-Age=28800");
    await login.body?.cancel();
    const res = await me({ cookie: cookie.split(";")[0] ?? "" });
    expect((await json<{ employee: { id: string } }>(res)).employee.id).toBe(ADMIN);
  });
});

describe("dev-only triage config", () => {
  it("/api/dev/triage reports the provider and LLM endpoint this server's Workflow calls", async () => {
    expect((await call("/api/dev/triage")).status).toBe(401);
    const res = await call("/api/dev/triage", { headers: authHeaders(await tokenFor(EMPLOYEE)) });
    expect(res.status).toBe(200);
    expect(await json(res)).toEqual({ provider: "stub", llmBaseUrl: "http://127.0.0.1:9/v1", llmModel: "unused-in-tests" });
  });
});

describe("request guards", () => {
  it("dev mode answers 403 to a non-localhost host", async () => {
    const res = await exports.default.fetch(new Request("https://placessync.example.com/api/health"));
    expect(res.status).toBe(403);
    expect((await json(res)).error).toBe("dev_mode_remote_request");
  });

  it("rejects a cross-origin POST with 403", async () => {
    const res = await call("/api/dev/logout", { method: "POST", headers: { origin: "https://evil.example" } });
    expect(res.status).toBe(403);
    expect((await json(res)).error).toBe("forbidden_origin");
  });

  it("allows a same-origin POST", async () => {
    const res = await call("/api/dev/logout", { method: "POST", headers: { origin: BASE } });
    expect(res.status).toBe(200);
    await res.body?.cancel();
  });

  it("rejects a cross-origin WebSocket upgrade with 403", async () => {
    const res = await call("/api/sites/hq/live", {
      headers: { upgrade: "websocket", origin: "https://evil.example", ...authHeaders(await tokenFor(EMPLOYEE)) },
    });
    expect(res.status).toBe(403);
    expect((await json(res)).error).toBe("forbidden_origin");
  });
});

describe("site allowlist (SPEC 7.5)", () => {
  it.each(["/api/sites/evil/resources", "/api/sites/evil/availability?date=2026-10-12", "/api/sites/HQ/resources"])(
    "%s is 404 site_not_found and creates no Durable Object",
    async (path) => {
      const before = await listDurableObjectIds(env.SITE_LEDGER);
      const res = await call(path, { headers: authHeaders(await tokenFor(EMPLOYEE)) });
      expect(res.status).toBe(404);
      expect((await json(res)).error).toBe("site_not_found");
      expect(await listDurableObjectIds(env.SITE_LEDGER)).toEqual(before);
    },
  );

  it("an unknown site on the live endpoint is 404 and creates no Durable Object", async () => {
    const before = await listDurableObjectIds(env.SITE_LEDGER);
    const res = await call("/api/sites/evil/live", { headers: { upgrade: "websocket", ...authHeaders(await tokenFor(EMPLOYEE)) } });
    expect(res.status).toBe(404);
    expect((await json(res)).error).toBe("site_not_found");
    expect(await listDurableObjectIds(env.SITE_LEDGER)).toEqual(before);
  });
});

describe("access mode (production code path, SPEC 9.2)", () => {
  const TEAM = "https://team.cloudflareaccess.com";
  const accessEnv = { ...env, AUTH_MODE: "access", ACCESS_TEAM_DOMAIN: TEAM, ACCESS_AUD: "aud-test" } as Env;

  async function teamSetup() {
    const { publicKey, privateKey } = await generateKeyPair("RS256", { extractable: true });
    const pub = { ...(await exportJWK(publicKey)), kid: "team-key", alg: "RS256" };
    const priv = JSON.stringify({ ...(await exportJWK(privateKey)), kid: "team-key" });
    const fake = fakeJwksFetch({ keys: [pub] });
    const app = createApp({ ...defaultDeps, verifierFactory: makeVerifierFactory({ fetchImpl: fake.fetch }) });
    const send = async (path: string, init: RequestInit = {}, e: Env = accessEnv) => {
      const ctx = createExecutionContext();
      const res = await app.fetch(new Request(`${BASE}${path}`, init), e, ctx);
      await waitOnExecutionContext(ctx);
      return res;
    };
    const teamToken = async (employeeId: string) =>
      (
        await signDevToken({
          privateJwk: priv,
          issuer: TEAM,
          audience: "aud-test",
          email: emailOf(employeeId),
          sub: employeeId,
          nowMs: Date.now(),
        })
      ).token;
    return { fake, send, teamToken };
  }

  it("verifies a team token against the remote JWKS at /cdn-cgi/access/certs", async () => {
    const { fake, send, teamToken } = await teamSetup();
    const res = await send("/api/me", { headers: authHeaders(await teamToken(EMPLOYEE)) });
    expect(res.status).toBe(200);
    expect((await json<{ employee: { id: string } }>(res)).employee.id).toBe(EMPLOYEE);
    expect(fake.urls).toEqual([`${TEAM}/cdn-cgi/access/certs`]);
  });

  it("rejects a dev token", async () => {
    const { send } = await teamSetup();
    const res = await send("/api/me", { headers: authHeaders(await tokenFor(EMPLOYEE)) });
    expect(res.status).toBe(401);
    await res.body?.cancel();
  });

  it("ignores the cookie (header only)", async () => {
    const { send, teamToken } = await teamSetup();
    const res = await send("/api/me", { headers: { cookie: `CF_Authorization=${await teamToken(EMPLOYEE)}` } });
    expect(res.status).toBe(401);
    expect((await json(res)).error).toBe("unauthenticated");
  });

  it.each(["/api/dev/users", "/api/dev/seed", "/api/dev/login", "/api/dev/triage", "/api/dev/naive/reset", "/api/dev/naive/reserve", "/api/dev/naive/export"])(
    "%s is not mounted (404)",
    async (path) => {
      const { send, teamToken } = await teamSetup();
      const method = path.endsWith("users") || path.endsWith("export") || path.endsWith("triage") ? "GET" : "POST";
      const res = await send(path, { method, headers: authHeaders(await teamToken(ADMIN)) });
      expect(res.status).toBe(404);
      await res.body?.cancel();
    },
  );

  it.each([
    ["missing ACCESS_AUD", { ACCESS_AUD: undefined }],
    ["SET_ME ACCESS_AUD", { ACCESS_AUD: "SET_ME" }],
    ["SET_ME team domain", { ACCESS_TEAM_DOMAIN: "https://SET_ME.cloudflareaccess.com" }],
  ])("%s gives 500 misconfigured", async (_name, override) => {
    const { send, teamToken } = await teamSetup();
    const res = await send("/api/me", { headers: authHeaders(await teamToken(EMPLOYEE)) }, { ...accessEnv, ...override } as Env);
    expect(res.status).toBe(500);
    expect((await json(res)).error).toBe("misconfigured");
  });

  it("does not apply the dev-mode host guard", async () => {
    const { fake } = await teamSetup();
    const app = createApp({ ...defaultDeps, verifierFactory: makeVerifierFactory({ fetchImpl: fake.fetch }) });
    const ctx = createExecutionContext();
    const res = await app.fetch(new Request("https://placessync-production.example.workers.dev/api/health"), accessEnv, ctx);
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(200);
    expect((await json(res)).authMode).toBe("access");
  });
});
