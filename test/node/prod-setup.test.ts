// prod-setup's plan, the Access desired state and prod-doctor's report, from recorded
// state shapes (no network, no wrangler). The setup must stop before deploying anything
// when Access cannot be configured, converge rather than duplicate, and the doctor must
// name exactly what is missing.
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { DESIRED, appBody, appDrift, findApp, planAccess, policyBody, policyDrift } from "../../scripts/lib/access-plan.ts";
import { CfApi, CfApiError, tokenFromEnv } from "../../scripts/lib/cf-api.ts";
import { PERSONAS, PLACEHOLDER, PROD, PROD_HOST, PROD_URL, type ProductionValues } from "../../scripts/lib/prod-config.ts";
import { type ProdState, doctorReport, gatherState } from "../../scripts/lib/prod-state.ts";
import { describeStep, planSetup } from "../../scripts/prod-setup.ts";
import { WRANGLER_CREDENTIAL_VARS, childEnv, findD1, parsePendingMigrations, parseWhoami, type Runner } from "../../scripts/lib/wrangler-cli.ts";

const D1 = "0f0e0d0c-0b0a-4908-8706-050403020100";
const AUD = "b".repeat(64);
const OTP = { id: "idp-otp", name: "One-time PIN login", type: "onetimepin" };
const POLICY = { id: "pol-1", ...(policyBody() as { name: string; decision: string; include: { email: { email: string } }[] }) };
const APP = { id: "app-1", aud: AUD, ...(appBody(OTP.id, POLICY.id) as Record<string, unknown>) } as unknown as import("../../scripts/lib/cf-api.ts").AccessApp;

function config(over: Partial<ProductionValues> = {}): ProductionValues {
  return {
    accountId: PROD.accountId,
    databaseName: PROD.d1Name,
    databaseId: PLACEHOLDER,
    teamDomain: PROD.teamDomain,
    accessAud: PLACEHOLDER,
    workersDev: true,
    previewUrls: false,
    vars: {},
    ...over,
  };
}

const ok = <T>(value: T) => ({ ok: true as const, value });

/** A brand-new account: logged in, nothing created. */
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
    idps: ok([]),
    policies: ok([]),
    apps: ok([]),
    accountCrons: ok([]),
    probe: ok({ status: 404, location: null, server: "cloudflare" }),
    ...over,
  };
}

/** Everything in place. */
function done(): ProdState {
  return fresh({
    config: config({ databaseId: D1, accessAud: AUD }),
    d1: ok({ uuid: D1 }),
    pendingMigrations: ok([]),
    catalog: ok({ sites: 1, resources: 20, people: PERSONAS.map((p) => ({ email: p.email, role: p.role, active: 1 })) }),
    deployments: ok(1),
    workflow: ok(true),
    idps: ok([OTP]),
    policies: ok([POLICY]),
    apps: ok([APP]),
    accountCrons: ok([{ script: PROD.workerName, crons: ["*/2 * * * *"] }]),
    probe: ok({ status: 302, location: `${PROD.teamDomain}/cdn-cgi/access/login/${PROD_HOST}?kid=x`, server: "cloudflare" }),
  });
}

const kinds = (s: ProdState) => planSetup(s).map((x) => (x.kind === "access" ? `access:${x.action.kind}` : x.kind));

describe("planSetup", () => {
  it("on a fresh account: D1, migrations, seed, a fail-closed first deploy, Access, AUD, deploy, rebuild, probe", () => {
    expect(kinds(fresh())).toEqual([
      "create-d1",
      "write-d1-id",
      "apply-migrations",
      "seed-catalog",
      "first-deploy",
      "access:create-otp",
      "access:create-policy",
      "access:create-app",
      "write-aud",
      "deploy",
      "restore-local-build",
      "probe",
    ]);
  });

  it("without the API token, prepares D1 and stops before deploying anything", () => {
    const steps = kinds(fresh({ token: false, teamDomain: null, subdomain: null, idps: null, policies: null, apps: null, accountCrons: null }));
    expect(steps).toEqual(["create-d1", "write-d1-id", "apply-migrations", "seed-catalog", "stop"]);
    expect(steps).not.toContain("first-deploy");
  });

  it("stops at once when wrangler is not logged in to the account, or the token's team or subdomain is wrong", () => {
    expect(kinds(fresh({ whoami: ok({ loggedIn: true, email: "x", accountIds: ["other"] }) }))).toEqual(["stop"]);
    expect(kinds(fresh({ teamDomain: ok("https://someone-else.cloudflareaccess.com") }))).toEqual(["stop"]);
    expect(kinds(fresh({ subdomain: ok("other") }))).toEqual(["stop"]);
  });

  it("refuses to overwrite a real D1 id in wrangler.jsonc that differs from the account's", () => {
    const plan = planSetup(fresh({ config: config({ databaseId: D1 }), d1: ok({ uuid: "11111111-2222-4333-8444-555555555555" }) }));
    expect(plan).toHaveLength(1);
    expect(describeStep(plan[0] as never)).toMatch(/fix wrangler.jsonc by hand/);
  });

  it("when everything exists, only redeploys, rebuilds and probes (migrations and seed are idempotent reruns)", () => {
    expect(kinds(done())).toEqual(["apply-migrations", "seed-catalog", "deploy", "restore-local-build", "probe"]);
  });

  it("converges drift instead of creating duplicates", () => {
    const s = done();
    const extra = { ...POLICY, include: [...POLICY.include, { email: { email: "stranger@example.com" } }] };
    const staleApp = { ...APP, session_duration: "24h" };
    expect(kinds({ ...s, policies: ok([extra]), apps: ok([staleApp]) })).toEqual([
      "apply-migrations",
      "seed-catalog",
      "access:update-policy",
      "access:update-app",
      "deploy",
      "restore-local-build",
      "probe",
    ]);
  });

  it("writes the AUD when wrangler.jsonc still has the placeholder", () => {
    const s = done();
    expect(kinds({ ...s, config: config({ databaseId: D1 }) })).toContain("write-aud");
  });
});

describe("Access desired state", () => {
  it("is a hostname app for the workers.dev host with One-time PIN only and one email policy", () => {
    expect(appBody("otp", "pol")).toMatchObject({
      type: "self_hosted",
      domain: PROD_HOST,
      destinations: [{ type: "public", uri: PROD_HOST }],
      allowed_idps: ["otp"],
      auto_redirect_to_identity: true,
      session_duration: "8h",
      policies: [{ id: "pol", precedence: 1 }],
    });
    expect(policyBody()).toEqual({
      name: "placessync-owner-and-personas",
      decision: "allow",
      include: [...PERSONAS.map((p) => p.email)].sort().map((email) => ({ email: { email } })),
    });
  });

  it("finds drift, and nothing when the app and policy match", () => {
    expect(appDrift(APP, OTP.id, POLICY.id)).toEqual([]);
    expect(policyDrift(POLICY)).toEqual([]);
    expect(policyDrift({ ...POLICY, include: [{ everyone: {} }] })).toContain("include has rules other than single emails");
    expect(appDrift({ ...APP, allowed_idps: [OTP.id, "github"] }, OTP.id, POLICY.id)).toEqual(["allowed identity providers are not exactly the One-time PIN login"]);
  });

  it("refuses to pick between two apps on the same host", () => {
    expect(() => findApp([APP, { ...APP, id: "app-2", name: "other" }])).toThrow(/2 Access applications/);
    expect(findApp([{ ...APP, domain: "elsewhere.example.com", destinations: [] }])).toBeNull();
  });

  it("plans nothing when the account matches", () => {
    expect(planAccess({ idps: [OTP], policies: [POLICY], apps: [APP] })).toEqual([]);
    expect(DESIRED.emails).toEqual(PERSONAS.map((p) => p.email));
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
      "access.app",
      "access.aud",
      "free.crons",
      "edge.access",
    ]);
  });

  it("names exactly what a fresh account is missing", () => {
    const s = status(fresh());
    expect(Object.entries(s).filter(([, v]) => v === "missing").map(([k]) => k)).toEqual([
      "config.d1-id",
      "config.access-aud",
      "d1.database",
      "worker.deployed",
      "worker.workflow",
      "access.otp",
      "access.policy",
      "access.app",
      "edge.access",
    ]);
    expect(s["d1.migrations"]).toBe("unknown");
  });

  it("flags a Worker answering without Access, a missing persona, and too many account crons", () => {
    const s = done();
    expect(status({ ...s, probe: ok({ status: 500, location: null, server: "cloudflare" }) })["edge.access"]).toBe("missing");
    const people = PERSONAS.slice(0, 2).map((p) => ({ email: p.email, role: p.role, active: 1 }));
    expect(status({ ...s, catalog: ok({ sites: 1, resources: 20, people }) })["d1.catalog"]).toBe("missing");
    const crons = [1, 2, 3].map((n) => ({ script: `other-${n}`, crons: ["0 * * * *", "30 * * * *"] }));
    expect(status({ ...s, accountCrons: ok(crons) })["free.crons"]).toBe("missing");
  });
});

describe("gatherState is read-only", () => {
  it("only runs wrangler list, info, whoami and SELECT commands, and only GETs", async () => {
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
    const fakeFetch = (async (url: string | URL | Request, init?: RequestInit) => {
      methods.push(`${init?.method ?? "GET"} ${String(url)}`);
      if (String(url).startsWith(PROD_URL)) return new Response(null, { status: 404 });
      return Response.json({ success: true, errors: [], result: String(url).endsWith("/organizations") ? { auth_domain: "old-truth-a7dc.cloudflareaccess.com" } : [] });
    }) as typeof fetch;
    const s = await gatherState({ wrangler: runner, api: new CfApi(PROD.accountId, "test-token", fakeFetch), fetchImpl: fakeFetch, config: config({ databaseId: D1 }) });
    expect(s.d1).toEqual(ok({ uuid: D1 }));
    for (const args of calls) {
      const cmd = args.slice(0, 3).join(" ");
      expect(["whoami --json", "d1 list --json", "d1 migrations list", "d1 execute DB", "deployments list --name", "workflows list --json", "ai models list"]).toContain(cmd);
      if (args[1] === "execute") expect(args[args.indexOf("--command") + 1]).toMatch(/^SELECT /);
    }
    expect(methods.every((m) => m.startsWith("GET "))).toBe(true);
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
