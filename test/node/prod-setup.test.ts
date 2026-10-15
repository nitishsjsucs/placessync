// prod-setup's plan, the Access desired state and prod-doctor's report, from recorded
// state shapes (no network, no wrangler). The setup must stop before deploying anything
// when Access cannot be configured, only reference the existing One-time PIN login,
// converge rather than duplicate, change nothing on a finished account, and the doctor
// must name exactly what is missing.
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  DESIRED,
  appBody,
  appDrift,
  checkOtp,
  findApp,
  findServiceToken,
  planAccess,
  policyBody,
  policyDrift,
  servicePolicyBody,
  servicePolicyDrift,
} from "../../scripts/lib/access-plan.ts";
import { type AccessApp, type AccessPolicy, CfApi, CfApiError, type ServiceToken, tokenFromEnv } from "../../scripts/lib/cf-api.ts";
import { PERSONAS, PLACEHOLDER, PROD, PROD_HOST, PROD_URL, type ProductionValues, SEED_PEOPLE, VERIFY_PRINCIPAL } from "../../scripts/lib/prod-config.ts";
import { type ProdState, doctorReport, gatherState } from "../../scripts/lib/prod-state.ts";
import { describeStep, planSetup } from "../../scripts/prod-setup.ts";
import { WRANGLER_CREDENTIAL_VARS, childEnv, findD1, parsePendingMigrations, parseWhoami, type Runner } from "../../scripts/lib/wrangler-cli.ts";

const D1 = "0f0e0d0c-0b0a-4908-8706-050403020100";
const AUD = "b".repeat(64);
const CLIENT_ID = "0123456789abcdef0123456789abcdef.access";
const NOW = new Date("2026-10-15T20:00:00.000Z");
const OTP = { id: PROD.otpIdpId, name: "One-time PIN", type: "onetimepin" };
const TOKEN: ServiceToken = { id: "tok-1", name: PROD.serviceTokenName, client_id: CLIENT_ID, duration: "8760h", expires_at: "2027-10-15T20:00:00Z" };
const POLICY = { id: "pol-1", ...(policyBody() as { name: string; decision: string; include: { email: { email: string } }[] }) } as AccessPolicy;
const SPOLICY = { id: "pol-2", ...(servicePolicyBody(TOKEN.id) as Record<string, unknown>) } as unknown as AccessPolicy;
const APP = { id: "app-1", aud: AUD, ...(appBody(POLICY.id, SPOLICY.id) as Record<string, unknown>) } as unknown as AccessApp;

function config(over: Partial<ProductionValues> = {}): ProductionValues {
  return {
    accountId: PROD.accountId,
    databaseName: PROD.d1Name,
    databaseId: PLACEHOLDER,
    teamDomain: PROD.teamDomain,
    accessAud: PLACEHOLDER,
    serviceClientId: PLACEHOLDER,
    triageProvider: PLACEHOLDER,
    workersDev: true,
    previewUrls: false,
    vars: {},
    ...over,
  };
}

const ok = <T>(value: T) => ({ ok: true as const, value });

/** A brand-new account: logged in, the One-time PIN login exists, nothing else created. */
function fresh(over: Partial<ProdState> = {}): ProdState {
  return {
    config: config(),
    whoami: ok({ loggedIn: true, email: "owner@example.com", accountIds: [PROD.accountId] }),
    d1: ok(null),
    pendingMigrations: null,
    catalog: null,
    deployments: ok(0),
    workflow: ok(false),
    model: ok(true),
    token: true,
    teamDomain: ok(PROD.teamDomain),
    subdomain: ok(PROD.workersSubdomain),
    idps: ok([OTP]),
    policies: ok([]),
    apps: ok([]),
    serviceTokens: ok([]),
    localClientId: null,
    accountCrons: ok([]),
    probe: ok({ status: 404, location: null, server: "cloudflare" }),
    serviceProbe: null,
    now: NOW,
    ...over,
  };
}

/** Everything in place. */
function done(): ProdState {
  return fresh({
    config: config({ databaseId: D1, accessAud: AUD, serviceClientId: CLIENT_ID, triageProvider: "workers-ai" }),
    d1: ok({ uuid: D1 }),
    pendingMigrations: ok([]),
    catalog: ok({ sites: 1, resources: 20, people: SEED_PEOPLE.map((p) => ({ email: p.email, role: p.role, active: 1 })) }),
    deployments: ok(1),
    workflow: ok(true),
    policies: ok([POLICY, SPOLICY]),
    apps: ok([APP]),
    serviceTokens: ok([TOKEN]),
    localClientId: CLIENT_ID,
    accountCrons: ok([{ script: PROD.workerName, crons: ["*/2 * * * *"] }]),
    probe: ok({ status: 302, location: `${PROD.teamDomain}/cdn-cgi/access/login/${PROD_HOST}?kid=x`, server: "cloudflare" }),
    serviceProbe: ok({ healthStatus: 200, health: { authMode: "access", triage: "ready", seeded: true }, meStatus: 200, employeeId: VERIFY_PRINCIPAL.id, role: "employee" }),
  });
}

const kinds = (s: ProdState, opts?: { redeploy?: boolean }) => planSetup(s, opts).map((x) => (x.kind === "access" ? `access:${x.action.kind}` : x.kind));

describe("planSetup", () => {
  it("on a fresh account: D1, migrations, seed, a fail-closed first deploy, Access, the config values, deploy, rebuild, probe", () => {
    expect(kinds(fresh())).toEqual([
      "create-d1",
      "write-d1-id",
      "apply-migrations",
      "seed-catalog",
      "first-deploy",
      "access:create-policy",
      "access:create-service-token",
      "access:create-service-policy",
      "access:create-app",
      "write-aud",
      "write-service-client-id",
      "write-provider",
      "deploy",
      "restore-local-build",
      "probe",
    ]);
  });

  it("without the API token, changes nothing", () => {
    const plan = planSetup(fresh({ token: false, teamDomain: null, subdomain: null, idps: null, policies: null, apps: null, serviceTokens: null, accountCrons: null }));
    expect(plan.map((x) => x.kind)).toEqual(["stop"]);
    expect(describeStep(plan[0] as never)).toMatch(/CF_API_TOKEN/);
  });

  it("stops at once when wrangler is not logged in to the account, the token's team or subdomain is wrong, Access cannot be read, or the model is missing", () => {
    expect(kinds(fresh({ whoami: ok({ loggedIn: true, email: "x", accountIds: ["other"] }) }))).toEqual(["stop"]);
    expect(kinds(fresh({ serviceTokens: { ok: false, reason: "HTTP 403" } }))).toEqual(["stop"]);
    expect(kinds(fresh({ teamDomain: ok("https://someone-else.cloudflareaccess.com") }))).toEqual(["stop"]);
    expect(kinds(fresh({ subdomain: ok("other") }))).toEqual(["stop"]);
    expect(kinds(fresh({ model: ok(false) }))).toEqual(["stop"]);
  });

  it("never creates a login method: without the One-time PIN login it stops before changing anything", () => {
    for (const idps of [[], [{ ...OTP, type: "github" }], [{ ...OTP, id: "another-otp" }]]) {
      const plan = planSetup(fresh({ idps: ok(idps) }));
      expect(plan.map((s) => s.kind)).toEqual(["stop"]);
      expect(describeStep(plan[0] as never)).toMatch(new RegExp(PROD.otpIdpId));
    }
  });

  it("refuses to overwrite a real D1 id in wrangler.jsonc that differs from the account's", () => {
    const plan = planSetup(fresh({ config: config({ databaseId: D1 }), d1: ok({ uuid: "11111111-2222-4333-8444-555555555555" }) }));
    expect(plan).toHaveLength(1);
    expect(describeStep(plan[0] as never)).toMatch(/fix wrangler.jsonc by hand/);
  });

  it("changes nothing on a finished account: it only probes (and redeploys only when asked)", () => {
    expect(kinds(done())).toEqual(["probe"]);
    expect(kinds(done(), { redeploy: true })).toEqual(["deploy", "restore-local-build", "probe"]);
  });

  it("applies pending migrations and reseeds an incomplete catalog without redeploying", () => {
    expect(kinds({ ...done(), pendingMigrations: ok(["0005_next.sql"]) })).toEqual(["apply-migrations", "seed-catalog", "probe"]);
    const people = PERSONAS.map((p) => ({ email: p.email, role: p.role, active: 1 }));
    expect(kinds({ ...done(), catalog: ok({ sites: 1, resources: 20, people }) })).toEqual(["seed-catalog", "probe"]);
  });

  it("converges drift instead of creating duplicates; Access changes need no redeploy", () => {
    const s = done();
    const extra = { ...POLICY, include: [...POLICY.include, { email: { email: "stranger@example.com" } }] };
    const staleApp = { ...APP, session_duration: "24h" };
    const openService = { ...SPOLICY, include: [{ everyone: {} }] } as unknown as AccessPolicy;
    expect(kinds({ ...s, policies: ok([extra, openService]), apps: ok([staleApp]) })).toEqual(["access:update-policy", "access:update-service-policy", "access:update-app", "probe"]);
  });

  it("rotates the service token's secret when this Mac does not hold it, keeping the Client ID", () => {
    expect(kinds({ ...done(), localClientId: null })).toEqual(["access:rotate-service-token", "probe"]);
    expect(kinds({ ...done(), localClientId: "ffffffffffffffffffffffffffffffff.access" })).toEqual(["access:rotate-service-token", "probe"]);
  });

  it("writes each setup value still missing from wrangler.jsonc, then redeploys", () => {
    const s = done();
    expect(kinds({ ...s, config: config({ databaseId: D1, serviceClientId: CLIENT_ID, triageProvider: "workers-ai" }) })).toEqual(["write-aud", "deploy", "restore-local-build", "probe"]);
    expect(kinds({ ...s, config: config({ databaseId: D1, accessAud: AUD, triageProvider: "workers-ai" }) })).toEqual(["write-service-client-id", "deploy", "restore-local-build", "probe"]);
    expect(kinds({ ...s, config: config({ databaseId: D1, accessAud: AUD, serviceClientId: CLIENT_ID }) })).toEqual(["write-provider", "deploy", "restore-local-build", "probe"]);
  });
});

describe("Access desired state", () => {
  it("is a hostname app for the workers.dev host with only the existing One-time PIN login, then Allow and Service Auth policies", () => {
    expect(appBody("pol", "svc")).toMatchObject({
      type: "self_hosted",
      domain: PROD_HOST,
      destinations: [{ type: "public", uri: PROD_HOST }],
      allowed_idps: ["743683e8-42d4-44e9-9991-ba57a1bb0dec"],
      auto_redirect_to_identity: true,
      session_duration: "8h",
      policies: [
        { id: "pol", precedence: 1 },
        { id: "svc", precedence: 2 },
      ],
    });
    expect(policyBody()).toEqual({
      name: "placessync-owner-and-personas",
      decision: "allow",
      include: [...PERSONAS.map((p) => p.email)].sort().map((email) => ({ email: { email } })),
    });
    expect(servicePolicyBody("tok-9")).toEqual({ name: "placessync-verify-service-auth", decision: "non_identity", include: [{ service_token: { token_id: "tok-9" } }] });
    // The verification employee's address is never in the Allow policy.
    expect(DESIRED.emails).not.toContain(VERIFY_PRINCIPAL.email);
  });

  it("finds drift, and nothing when the app and policies match", () => {
    expect(appDrift(APP, POLICY.id, SPOLICY.id)).toEqual([]);
    expect(policyDrift(POLICY)).toEqual([]);
    expect(servicePolicyDrift(SPOLICY, TOKEN.id)).toEqual([]);
    expect(policyDrift({ ...POLICY, include: [{ everyone: {} }] })).toContain("include has rules other than single emails");
    expect(servicePolicyDrift({ ...SPOLICY, decision: "allow" }, TOKEN.id)).toEqual(["decision is allow, want non_identity (Service Auth)"]);
    expect(servicePolicyDrift(SPOLICY, "tok-other")).toEqual(["include is not exactly the verification service token"]);
    expect(appDrift({ ...APP, allowed_idps: [OTP.id, "github"] }, POLICY.id, SPOLICY.id)).toEqual([`allowed identity providers are not exactly the One-time PIN login ${PROD.otpIdpId}`]);
    expect(appDrift({ ...APP, policies: [{ id: POLICY.id, precedence: 1 }] }, POLICY.id, SPOLICY.id)).toHaveLength(1);
  });

  it("refuses to pick between two apps on the same host, or two service tokens with the setup's name", () => {
    expect(() => findApp([APP, { ...APP, id: "app-2", name: "other" }])).toThrow(/2 Access applications/);
    expect(findApp([{ ...APP, domain: "elsewhere.example.com", destinations: [] }])).toBeNull();
    expect(() => findServiceToken([TOKEN, { ...TOKEN, id: "tok-2" }])).toThrow(/2 service tokens/);
  });

  it("plans nothing when the account matches, and checks the One-time PIN login by id", () => {
    expect(planAccess({ idps: [OTP], policies: [POLICY, SPOLICY], apps: [APP], serviceTokens: [TOKEN], localClientId: CLIENT_ID })).toEqual([]);
    expect(DESIRED.emails).toEqual(PERSONAS.map((p) => p.email));
    expect(checkOtp([OTP]).ok).toBe(true);
    expect(checkOtp([{ ...OTP, type: "azureAD" }])).toEqual({ ok: false, reason: `login method ${PROD.otpIdpId} is azureAD, not One-time PIN` });
    expect(() => planAccess({ idps: [], policies: [], apps: [], serviceTokens: [], localClientId: null })).toThrow(/no login method/);
  });
});

describe("doctorReport", () => {
  const status = (s: ProdState) => Object.fromEntries(doctorReport(s).map((c) => [c.id, c.status]));

  it("reports everything ok when everything is in place", () => {
    const report = doctorReport(done());
    expect(report.filter((c) => c.status !== "ok")).toEqual([]);
    expect(report.map((c) => c.id)).toEqual([
      "config.account",
      "config.team-domain",
      "config.d1-id",
      "config.access-aud",
      "config.service-client-id",
      "config.provider",
      "wrangler.login",
      "d1.database",
      "d1.migrations",
      "d1.catalog",
      "worker.deployed",
      "worker.workflow",
      "workers-ai.model",
      "api.token",
      "access.team",
      "workers.subdomain",
      "access.otp",
      "access.policy",
      "access.service-token",
      "access.service-policy",
      "access.app",
      "access.aud",
      "free.crons",
      "edge.access",
      "edge.service-token",
    ]);
  });

  it("names exactly what a fresh account is missing", () => {
    const s = status(fresh());
    expect(Object.entries(s).filter(([, v]) => v === "missing").map(([k]) => k)).toEqual([
      "config.d1-id",
      "config.access-aud",
      "config.service-client-id",
      "config.provider",
      "d1.database",
      "worker.deployed",
      "worker.workflow",
      "access.policy",
      "access.service-token",
      "access.service-policy",
      "access.app",
      "edge.access",
    ]);
    expect(s["access.otp"]).toBe("ok");
    expect(s["d1.migrations"]).toBe("unknown");
    expect(s["edge.service-token"]).toBe("unknown");
  });

  it("flags a Worker answering without Access, a missing person, too many account crons, a lost or expiring token and a failing signed-in path", () => {
    const s = done();
    expect(status({ ...s, probe: ok({ status: 500, location: null, server: "cloudflare" }) })["edge.access"]).toBe("missing");
    const people = PERSONAS.map((p) => ({ email: p.email, role: p.role, active: 1 }));
    expect(status({ ...s, catalog: ok({ sites: 1, resources: 20, people }) })["d1.catalog"]).toBe("missing");
    const crons = [1, 2, 3].map((n) => ({ script: `other-${n}`, crons: ["0 * * * *", "30 * * * *"] }));
    expect(status({ ...s, accountCrons: ok(crons) })["free.crons"]).toBe("missing");
    expect(status({ ...s, localClientId: null })["access.service-token"]).toBe("missing");
    expect(status({ ...s, serviceTokens: ok([{ ...TOKEN, expires_at: "2026-10-30T00:00:00Z" }]) })["access.service-token"]).toBe("missing");
    expect(status({ ...s, idps: ok([]) })["access.otp"]).toBe("missing");
    const misconfigured = ok({ healthStatus: 500, health: { error: "misconfigured" }, meStatus: 500, employeeId: null, role: null });
    expect(status({ ...s, serviceProbe: misconfigured })["edge.service-token"]).toBe("missing");
    const stub = ok({ healthStatus: 200, health: { authMode: "access", triage: "misconfigured", seeded: true }, meStatus: 200, employeeId: VERIFY_PRINCIPAL.id, role: "employee" });
    expect(status({ ...s, serviceProbe: stub })["edge.service-token"]).toBe("missing");
  });
});

describe("gatherState is read-only", () => {
  it("only runs wrangler list, info, whoami and SELECT commands, only GETs, and never puts the secret in state", async () => {
    const calls: string[][] = [];
    const runner: Runner = async (args) => {
      calls.push(args);
      if (args[0] === "whoami") return { code: 0, stdout: JSON.stringify({ loggedIn: true, email: "o@example.com", accounts: [{ id: PROD.accountId }] }), stderr: "" };
      if (args[0] === "d1" && args[1] === "list") return { code: 0, stdout: JSON.stringify([{ name: PROD.d1Name, uuid: D1 }]), stderr: "" };
      if (args[0] === "d1" && args[1] === "migrations") return { code: 0, stdout: "✅ No migrations to apply!", stderr: "" };
      if (args[0] === "d1" && args[1] === "execute") return { code: 0, stdout: JSON.stringify([{ results: [{ sites: 1, resources: 20, people: "[]" }] }]), stderr: "" };
      return { code: 0, stdout: "[]", stderr: "" };
    };
    const methods: string[] = [];
    const secret = "secret_SHOULD_NOT_BE_IN_STATE";
    const fakeFetch = (async (url: string | URL | Request, init?: RequestInit) => {
      methods.push(`${init?.method ?? "GET"} ${String(url)}`);
      if (String(url).startsWith(PROD_URL)) return new Response(null, { status: 404 });
      return Response.json({ success: true, errors: [], result: String(url).endsWith("/organizations") ? { auth_domain: "old-truth-a7dc.cloudflareaccess.com" } : [] });
    }) as typeof fetch;
    const s = await gatherState({
      wrangler: runner,
      api: new CfApi(PROD.accountId, "test-token", fakeFetch),
      fetchImpl: fakeFetch,
      config: config({ databaseId: D1 }),
      localClientId: CLIENT_ID,
      serviceHeaders: { "CF-Access-Client-Id": CLIENT_ID, "CF-Access-Client-Secret": secret },
    });
    expect(s.d1).toEqual(ok({ uuid: D1 }));
    for (const args of calls) {
      const cmd = args.slice(0, 3).join(" ");
      expect(["whoami --json", "d1 list --json", "d1 migrations list", "d1 execute DB", "deployments list --name", "workflows list --json", "ai models list"]).toContain(cmd);
      if (args[1] === "execute") expect(args[args.indexOf("--command") + 1]).toMatch(/^SELECT /);
    }
    expect(methods.every((m) => m.startsWith("GET "))).toBe(true);
    expect(methods).toContain(`GET ${PROD_URL}/api/me`);
    expect(methods.some((m) => m.includes("/access/service_tokens"))).toBe(true);
    expect(JSON.stringify(s)).not.toContain(secret);
  });
});

describe("wrangler and API helpers", () => {
  it("parse wrangler output", () => {
    expect(parseWhoami({ code: 1, stdout: "", stderr: "not authenticated" }).loggedIn).toBe(false);
    expect(findD1({ code: 0, stdout: `banner\n${JSON.stringify([{ name: "placessync", uuid: D1 }])}`, stderr: "" }, "placessync")).toEqual({ uuid: D1 });
    const table = "Migrations to be applied:\n│ 0003_facilities.sql │\n│ 0004_request_change_ids.sql │";
    expect(parsePendingMigrations({ code: 0, stdout: table, stderr: "" })).toEqual(["0003_facilities.sql", "0004_request_change_ids.sql"]);
  });

  it("never exposes the token: not in errors, JSON or inspection", async () => {
    const secret = "tok_SHOULD_NOT_LEAK_123";
    const api = new CfApi(PROD.accountId, secret, (async () => Response.json({ success: false, errors: [{ code: 10000, message: "Authentication error" }] }, { status: 403 })) as typeof fetch);
    const err = await api.organization().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(CfApiError);
    expect(String((err as Error).message)).not.toContain(secret);
    expect((err as CfApiError).isPermission).toBe(true);
    expect(JSON.stringify(api)).not.toContain(secret);
    const { inspect } = await import("node:util");
    expect(inspect(api)).not.toContain(secret);
  });

  it("reads the token from CF_API_TOKEN, trimmed", () => {
    expect(tokenFromEnv({ CF_API_TOKEN: " b \n" })).toBe("b");
    expect(tokenFromEnv({ CF_API_TOKEN: "  " })).toBeNull();
    expect(tokenFromEnv({ CLOUDFLARE_API_TOKEN: "x" })).toBeNull();
    expect(tokenFromEnv({})).toBeNull();
  });

  it("never hands an API credential to wrangler, which would use it instead of its OAuth login", () => {
    const env = childEnv({ PATH: "/bin", HOME: "/home/x", CF_API_TOKEN: "t", CLOUDFLARE_API_TOKEN: "t2", CF_API_KEY: "k", CF_EMAIL: "e", CLOUDFLARE_API_KEY: "k2", CLOUDFLARE_EMAIL: "e2" });
    for (const name of WRANGLER_CREDENTIAL_VARS) expect(env[name]).toBeUndefined();
    expect(env).toMatchObject({ PATH: "/bin", HOME: "/home/x", CLOUDFLARE_ACCOUNT_ID: PROD.accountId });
    // wrangler reads each of these (CF_* as deprecated aliases); keep the list in step with it.
    const cli = readFileSync(path.join(import.meta.dirname, "..", "..", "node_modules", "wrangler", "wrangler-dist", "cli.js"), "utf8");
    for (const name of ["CF_API_TOKEN", "CF_API_KEY", "CF_EMAIL"]) expect(cli).toContain(`deprecatedName: "${name}"`);
  });
});
