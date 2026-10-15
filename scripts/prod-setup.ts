// Production setup for PlacesSync on the Workers Free plan: one idempotent command that
// creates or converges every Cloudflare resource, then deploys. Rerunning it changes only
// what is missing or different; on a finished account it changes nothing and only probes.
// It reads state first (the same read-only calls as prod:doctor), prints the plan, and
// asks before changing anything (--yes skips the question; --dry-run prints the plan and
// exits without changing anything; --plan is the same as --dry-run).
//
//   npx wrangler login                     once; setup uses wrangler's OAuth for Workers and D1
//   export CF_API_TOKEN=...                account API token for Access (README lists permissions)
//   npm run prod:setup -- --dry-run        plan only, changes nothing
//   npm run prod:setup                     plan, confirm, apply
//
// wrangler never sees CF_API_TOKEN (wrangler-cli.ts removes it from every child process),
// so it always uses its OAuth login. The token goes only into the Authorization header of
// Cloudflare API calls. No secret is printed: the service token's secret goes straight
// from the API response into .prod/verify-service-token.json (gitignored, 0600).
//
// Without CF_API_TOKEN, or when any check in step 1 fails, it changes nothing.
//
// Runbook (each step is skipped when already done):
//   1. Check wrangler is logged in to account dc93c3bc...; with the token, check the Zero
//      Trust team is old-truth-a7dc, the workers.dev subdomain is nitish-ratakonda, the
//      One-time PIN login 743683e8-... exists, and the Workers AI model is in the catalog.
//   2. D1: create `placessync` if missing; write its id into wrangler.jsonc env.production.
//   3. Apply unapplied migrations/ to it (`wrangler d1 migrations apply --remote`).
//   4. Seed the catalog, the owner and persona sign-ins and the verification employee
//      (.seed/catalog.sql, idempotent), unless the doctor's catalog check already passes.
//   5. First deploy only if the Worker does not exist yet and no Access application does.
//      ACCESS_AUD, ACCESS_SERVICE_CLIENT_ID and TRIAGE_PROVIDER are still placeholders, so
//      every API route answers 500 misconfigured and the cron sweep does nothing.
//   6. Access: the reusable Allow policy `placessync-owner-and-personas` (exactly the
//      owner and persona emails); the service token `placessync-verify` (its secret is
//      stored in .prod/; rotated if this Mac does not have it); the reusable Service Auth
//      policy `placessync-verify-service-auth` (exactly that token); and a self-hosted
//      application for placessync-production.nitish-ratakonda.workers.dev that allows only
//      the One-time PIN login and has those two policies.
//   7. Write the application's AUD, the service token's Client ID and the Workers AI
//      provider (TRIAGE_PROVIDER=workers-ai) into wrangler.jsonc env.production.
//   8. Deploy (`npm run deploy`) when any of steps 2 to 7 changed something, so the
//      running version carries the real values; then `npm run build` puts the local build
//      back (the production build replaced dist/). --redeploy forces both.
//   9. Probe: an unauthenticated GET /api/health must redirect to the team's sign-in, and
//      with the service token /api/me must answer as the verification employee.
//  10. Print the doctor report. Then: commit wrangler.jsonc, and run `npm run prod:verify`.
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createInterface } from "node:readline/promises";
import { parseArgs } from "node:util";
import { catalogSql } from "./export-catalog-sql.ts";
import {
  type AccessAction,
  DESIRED,
  appBody,
  findApp,
  findPolicy,
  findServicePolicy,
  findServiceToken,
  planAccess,
  policyBody,
  servicePolicyBody,
} from "./lib/access-plan.ts";
import { type AccessApp, CfApi, type ServiceToken, TOKEN_PERMISSIONS, tokenFromEnv } from "./lib/cf-api.ts";
import { ROOT } from "./lib/meta.ts";
import {
  PROD,
  PROD_URL,
  type ProductionKey,
  SEED_PEOPLE,
  VERIFY_PRINCIPAL,
  WRANGLER_CONFIG,
  isPlaceholder,
  readWranglerConfig,
  setProductionValue,
} from "./lib/prod-config.ts";
import { type ProdState, doctorReport, formatReport, gatherProduction } from "./lib/prod-state.ts";
import { describeCredentials, readServiceToken, serviceTokenHeaders, writeServiceToken } from "./lib/service-token-file.ts";
import { PROD_ENV_ARGS, findD1, lastLine, run, wrangler } from "./lib/wrangler-cli.ts";

export type Step =
  | { kind: "stop"; reason: string }
  | { kind: "create-d1" }
  | { kind: "write-d1-id"; uuid?: string }
  | { kind: "apply-migrations" }
  | { kind: "seed-catalog" }
  | { kind: "first-deploy" }
  | { kind: "access"; action: AccessAction }
  | { kind: "write-aud" }
  | { kind: "write-service-client-id" }
  | { kind: "write-provider" }
  | { kind: "deploy" }
  | { kind: "restore-local-build" }
  | { kind: "probe" };

/** True when the doctor's catalog check would pass: nothing for the seed to do. */
function catalogComplete(s: ProdState): boolean {
  if (!s.catalog?.ok) return false;
  const cat = s.catalog.value;
  return (
    cat.sites === 1 &&
    cat.resources === 20 &&
    SEED_PEOPLE.every((p) => cat.people.some((q) => q.email.toLowerCase() === p.email.toLowerCase() && q.role === p.role && Number(q.active) === 1))
  );
}

/** Steps that change the Worker's config, after which it must be deployed again. */
const CHANGES_DEPLOYMENT = new Set<Step["kind"]>(["write-d1-id", "write-aud", "write-service-client-id", "write-provider"]);

/** The ordered steps for this state. A "stop" step ends the run before anything after it. */
export function planSetup(s: ProdState, opts: { redeploy?: boolean } = {}): Step[] {
  const stop = (reason: string): Step[] => [{ kind: "stop", reason }];
  // 1. Checks; any failure means nothing is changed.
  if (!s.whoami.ok || !s.whoami.value.loggedIn || !s.whoami.value.accountIds.includes(PROD.accountId)) {
    return stop(`wrangler must be logged in to account ${PROD.accountId}: run npx wrangler login`);
  }
  // Without the token Access cannot be set up, and setup would leave a half-built account.
  if (!s.token) return stop("no account API token in CF_API_TOKEN, so Access cannot be set up; nothing was changed. Export the token (permissions below) and rerun.");
  if (s.teamDomain && !s.teamDomain.ok) return stop(`cannot read the Zero Trust organization: ${s.teamDomain.reason}`);
  if (s.teamDomain?.ok && s.teamDomain.value !== PROD.teamDomain) return stop(`the token's account has Zero Trust team ${s.teamDomain.value}, expected ${PROD.teamDomain}`);
  if (s.subdomain && !s.subdomain.ok) return stop(`cannot read the workers.dev subdomain: ${s.subdomain.reason}`);
  if (s.subdomain?.ok && s.subdomain.value !== PROD.workersSubdomain) return stop(`the account's workers.dev subdomain is ${s.subdomain.value ?? "unset"}, expected ${PROD.workersSubdomain}`);
  if (!s.model.ok) return stop(`cannot read the Workers AI model catalog: ${s.model.reason}`);
  if (!s.model.value) return stop(`${PROD.model} is not in the account's Workers AI catalog; pick another JSON-mode model for TRIAGE_MODEL and PROD.model`);
  if (!s.idps?.ok || !s.policies?.ok || !s.apps?.ok || !s.serviceTokens?.ok) {
    const why = [s.idps, s.policies, s.apps, s.serviceTokens].find((r) => r && !r.ok) as { reason: string } | undefined;
    return stop(`cannot read Access settings: ${why?.reason ?? "unknown"}`);
  }
  let actions: AccessAction[];
  let app: AccessApp | null;
  let token: ServiceToken | null;
  try {
    // Throws when the One-time PIN login is missing: setup never creates a login method.
    actions = planAccess({ idps: s.idps.value, policies: s.policies.value, apps: s.apps.value, serviceTokens: s.serviceTokens.value, localClientId: s.localClientId });
    app = findApp(s.apps.value);
    token = findServiceToken(s.serviceTokens.value);
  } catch (e) {
    return stop(e instanceof Error ? e.message : String(e));
  }
  if (!s.d1.ok) return stop(`cannot list D1 databases: ${s.d1.reason}`);

  // 2 to 4. D1.
  const steps: Step[] = [];
  const cfgId = s.config.databaseId;
  let newDb = false;
  if (s.d1.value === null) {
    if (cfgId && !isPlaceholder(cfgId)) return stop(`wrangler.jsonc names D1 database ${cfgId}, but the account has no ${PROD.d1Name}; fix wrangler.jsonc by hand`);
    steps.push({ kind: "create-d1" }, { kind: "write-d1-id" });
    newDb = true;
  } else if (cfgId !== s.d1.value.uuid) {
    if (cfgId && !isPlaceholder(cfgId)) return stop(`wrangler.jsonc names D1 database ${cfgId}, but the account's ${PROD.d1Name} is ${s.d1.value.uuid}; fix wrangler.jsonc by hand`);
    steps.push({ kind: "write-d1-id", uuid: s.d1.value.uuid });
    newDb = true;
  }
  const migrationsDone = !newDb && s.pendingMigrations?.ok === true && s.pendingMigrations.value.length === 0;
  if (!migrationsDone) steps.push({ kind: "apply-migrations" });
  if (!migrationsDone || !catalogComplete(s)) steps.push({ kind: "seed-catalog" });

  // 5 to 9. Worker and Access.
  const deployed = s.deployments.ok && s.deployments.value > 0;
  // The Worker exists before its Access application is created, in case Access checks the
  // hostname; until the AUD, service Client ID and provider are written it fails closed.
  if (!deployed && !app) steps.push({ kind: "first-deploy" });
  for (const action of actions) steps.push({ kind: "access", action });
  if (!app || app.aud !== s.config.accessAud) steps.push({ kind: "write-aud" });
  if (!token || token.client_id !== s.config.serviceClientId) steps.push({ kind: "write-service-client-id" });
  if (s.config.triageProvider !== "workers-ai") steps.push({ kind: "write-provider" });
  if (opts.redeploy || !deployed || steps.some((x) => CHANGES_DEPLOYMENT.has(x.kind))) steps.push({ kind: "deploy" }, { kind: "restore-local-build" });
  steps.push({ kind: "probe" });
  return steps;
}

export function describeStep(step: Step): string {
  switch (step.kind) {
    case "stop":
      return `STOP: ${step.reason}`;
    case "create-d1":
      return `create D1 database ${PROD.d1Name}`;
    case "write-d1-id":
      return `write the ${PROD.d1Name} database id into wrangler.jsonc env.production${step.uuid ? ` (${step.uuid})` : ""}`;
    case "apply-migrations":
      return "apply unapplied migrations/ to the remote database (wrangler d1 migrations apply --remote)";
    case "seed-catalog":
      return `seed the site, 20 resources and ${SEED_PEOPLE.length} people (${SEED_PEOPLE.map((p) => `${p.email} as ${p.role}`).join(", ")}); idempotent`;
    case "first-deploy":
      return `first deploy of ${PROD.workerName}, fail-closed (ACCESS_AUD, ACCESS_SERVICE_CLIENT_ID and TRIAGE_PROVIDER are placeholders, so the API answers 500)`;
    case "access": {
      const a = step.action;
      if (a.kind === "create-policy") return `create reusable Allow policy ${DESIRED.policyName} for ${DESIRED.emails.join(", ")}`;
      if (a.kind === "update-policy") return `update Allow policy ${DESIRED.policyName}: ${a.drift.join("; ")}`;
      if (a.kind === "create-service-token") return `create service token ${DESIRED.serviceTokenName} (${PROD.serviceTokenDuration}); its secret goes to .prod/, never to the terminal`;
      if (a.kind === "rotate-service-token") return `rotate service token ${DESIRED.serviceTokenName}'s secret (${a.why}); the new secret goes to .prod/`;
      if (a.kind === "create-service-policy") return `create reusable Service Auth policy ${DESIRED.servicePolicyName} for exactly ${DESIRED.serviceTokenName}`;
      if (a.kind === "update-service-policy") return `update Service Auth policy ${DESIRED.servicePolicyName}: ${a.drift.join("; ")}`;
      if (a.kind === "create-app") {
        return `create self-hosted Access application ${DESIRED.appName} for ${DESIRED.host} (login: One-time PIN ${DESIRED.otpIdpId} only; policies: ${DESIRED.policyName}, ${DESIRED.servicePolicyName}; ${DESIRED.sessionDuration} sessions)`;
      }
      return `update Access application ${DESIRED.appName}: ${a.drift.join("; ")}`;
    }
    case "write-aud":
      return "write the Access application's AUD into wrangler.jsonc ACCESS_AUD";
    case "write-service-client-id":
      return `write ${DESIRED.serviceTokenName}'s Client ID into wrangler.jsonc ACCESS_SERVICE_CLIENT_ID`;
    case "write-provider":
      return `write the Workers AI provider into wrangler.jsonc (TRIAGE_PROVIDER=workers-ai, model ${PROD.model})`;
    case "deploy":
      return `deploy ${PROD.workerName} (npm run deploy)`;
    case "restore-local-build":
      return "npm run build (the production build replaced dist/)";
    case "probe":
      return `check that an unauthenticated GET ${PROD_URL}/api/health redirects to ${PROD.teamDomain}, and that the service token reaches /api/me as ${VERIFY_PRINCIPAL.id}`;
  }
}

function must(r: { code: number; stdout: string; stderr: string }, what: string): void {
  if (r.code !== 0) throw new Error(`${what} failed: ${lastLine(r)}`);
}

function writeConfigValue(key: ProductionKey, value: string): boolean {
  const before = readWranglerConfig();
  const after = setProductionValue(before, key, value);
  if (after === before) return false;
  writeFileSync(WRANGLER_CONFIG, after);
  return true;
}

async function requireToken(api: CfApi) {
  const token = findServiceToken(await api.serviceTokens());
  if (!token) throw new Error(`service token ${DESIRED.serviceTokenName} not found`);
  return token;
}

async function applyAccess(a: AccessAction, api: CfApi): Promise<void> {
  switch (a.kind) {
    case "create-policy":
      await api.createAccessPolicy(policyBody());
      return;
    case "update-policy": {
      const p = findPolicy(await api.accessPolicies());
      if (!p) throw new Error("policy disappeared");
      await api.updateAccessPolicy(p.id, policyBody());
      return;
    }
    case "create-service-token": {
      const t = await api.createServiceToken({ name: DESIRED.serviceTokenName, duration: PROD.serviceTokenDuration });
      // Stored before anything else can fail: Cloudflare shows this secret only once.
      writeServiceToken({ tokenId: t.id, clientId: t.client_id, clientSecret: t.client_secret });
      console.log(`stored ${describeCredentials({ clientId: t.client_id })}`);
      return;
    }
    case "rotate-service-token": {
      const token = await requireToken(api);
      const r = await api.rotateServiceToken(token.id);
      writeServiceToken({ tokenId: token.id, clientId: r.client_id, clientSecret: r.client_secret });
      console.log(`stored ${describeCredentials({ clientId: r.client_id })}`);
      return;
    }
    case "create-service-policy":
      await api.createAccessPolicy(servicePolicyBody((await requireToken(api)).id));
      return;
    case "update-service-policy": {
      const p = findServicePolicy(await api.accessPolicies());
      if (!p) throw new Error("Service Auth policy disappeared");
      await api.updateAccessPolicy(p.id, servicePolicyBody((await requireToken(api)).id));
      return;
    }
    case "create-app":
    case "update-app": {
      const policies = await api.accessPolicies();
      const policy = findPolicy(policies);
      const servicePolicy = findServicePolicy(policies);
      if (!policy || !servicePolicy) throw new Error("both policies must exist before the application");
      const body = appBody(policy.id, servicePolicy.id);
      if (a.kind === "create-app") await api.createAccessApp(body);
      else {
        const app = findApp(await api.accessApps());
        if (!app) throw new Error("application disappeared");
        await api.updateAccessApp(app.id, body);
      }
      return;
    }
  }
}

async function probe(): Promise<void> {
  // Access settings and a new deployment can take a little while to reach the edge.
  const deadline = Date.now() + 180_000;
  const creds = readServiceToken();
  for (;;) {
    const res = await fetch(`${PROD_URL}/api/health`, { redirect: "manual" });
    await res.body?.cancel();
    const location = res.headers.get("location") ?? "";
    const redirected = res.status >= 300 && res.status < 400 && location.startsWith(`${PROD.teamDomain}/`);
    let signedIn = false;
    let detail = "";
    if (redirected && creds) {
      const me = await fetch(`${PROD_URL}/api/me`, { redirect: "manual", headers: serviceTokenHeaders(creds) });
      const body = (await me.json().catch(() => null)) as { employee?: { id?: string }; error?: string } | null;
      signedIn = me.status === 200 && body?.employee?.id === VERIFY_PRINCIPAL.id;
      detail = `service token /api/me answered ${me.status}${body?.error ? ` ${body.error}` : ""}`;
    }
    if (redirected && signedIn) {
      console.log(`unauthenticated: redirected to ${new URL(location).origin} sign-in (${res.status}); service token: /api/me is ${VERIFY_PRINCIPAL.id}`);
      return;
    }
    if (Date.now() > deadline) {
      if (!redirected) throw new Error(`GET /api/health still answers ${res.status} without credentials; Access is not in front of the Worker`);
      throw new Error(creds ? detail : "no stored service token credentials to check the signed-in path");
    }
    await new Promise((r) => setTimeout(r, 5_000));
  }
}

async function execute(steps: Step[], api: CfApi | null): Promise<void> {
  for (const step of steps) {
    console.log(`\n==> ${describeStep(step)}`);
    switch (step.kind) {
      case "stop":
        throw new Error(step.reason);
      case "create-d1":
        must(await wrangler(["d1", "create", PROD.d1Name, "--no-update-config"], { inherit: true }), "wrangler d1 create");
        break;
      case "write-d1-id": {
        const found = findD1(await wrangler(["d1", "list", "--json"]), PROD.d1Name);
        if (!found) throw new Error(`D1 database ${PROD.d1Name} not found after create`);
        console.log(writeConfigValue("database_id", found.uuid) ? `wrangler.jsonc: database_id = ${found.uuid}` : "wrangler.jsonc already has it");
        break;
      }
      case "apply-migrations":
        must(await wrangler(["d1", "migrations", "apply", "DB", "--remote", ...PROD_ENV_ARGS], { inherit: true }), "wrangler d1 migrations apply");
        break;
      case "seed-catalog": {
        const dir = path.join(ROOT, ".seed");
        mkdirSync(dir, { recursive: true });
        const file = path.join(dir, "catalog.sql");
        writeFileSync(file, `${catalogSql(SEED_PEOPLE, new Date().toISOString())}\n`);
        must(await wrangler(["d1", "execute", "DB", "--remote", ...PROD_ENV_ARGS, "--file", path.relative(ROOT, file), "--yes"], { inherit: true }), "wrangler d1 execute (catalog)");
        break;
      }
      case "first-deploy":
      case "deploy":
        must(await run("npm", ["run", "deploy"], { inherit: true }), "npm run deploy");
        break;
      case "access":
        if (!api) throw new Error("Access steps need the account API token");
        await applyAccess(step.action, api);
        console.log("done");
        break;
      case "write-aud": {
        if (!api) throw new Error("reading the AUD needs the account API token");
        const app = findApp(await api.accessApps());
        if (!app) throw new Error(`no Access application protects ${DESIRED.host}`);
        console.log(writeConfigValue("ACCESS_AUD", app.aud) ? "wrangler.jsonc: ACCESS_AUD set (the AUD tag is not a secret)" : "wrangler.jsonc already has it");
        break;
      }
      case "write-service-client-id": {
        if (!api) throw new Error("reading the service token needs the account API token");
        const token = await requireToken(api);
        console.log(writeConfigValue("ACCESS_SERVICE_CLIENT_ID", token.client_id) ? `wrangler.jsonc: ACCESS_SERVICE_CLIENT_ID = ${token.client_id} (the Client ID is not a secret)` : "wrangler.jsonc already has it");
        break;
      }
      case "write-provider":
        console.log(writeConfigValue("TRIAGE_PROVIDER", "workers-ai") ? "wrangler.jsonc: TRIAGE_PROVIDER = workers-ai" : "wrangler.jsonc already has it");
        break;
      case "restore-local-build":
        must(await run("npm", ["run", "build"], { inherit: true }), "npm run build");
        break;
      case "probe":
        await probe();
        break;
    }
  }
}

if (import.meta.main) {
  const { values } = parseArgs({
    options: {
      "dry-run": { type: "boolean", default: false },
      plan: { type: "boolean", default: false },
      yes: { type: "boolean", default: false },
      redeploy: { type: "boolean", default: false },
    },
  });
  const dryRun = values["dry-run"] || values.plan;
  const token = tokenFromEnv();
  const api = token ? new CfApi(PROD.accountId, token) : null;
  console.log(`PlacesSync production setup: account ${PROD.accountId}, ${PROD_URL}${token ? ", account API token present (not printed)" : ", no account API token"}${dryRun ? " (dry run: nothing will change)" : ""}`);
  const steps = planSetup(await gatherProduction(api), { redeploy: values.redeploy });
  console.log("\nPlan:");
  steps.forEach((s, i) => console.log(`  ${i + 1}. ${describeStep(s)}`));
  if (!token) console.log(`\nThe token needs:\n${TOKEN_PERMISSIONS.map((p) => `  - ${p}`).join("\n")}`);
  if (dryRun) process.exit(0);
  const runnable = steps.filter((s) => s.kind !== "stop");
  if (runnable.length === 0) {
    console.error(`\n${describeStep(steps[0] as Step)}`);
    process.exit(1);
  }
  if (!values.yes) {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const answer = (await rl.question("\nApply this plan to the Cloudflare account? [y/N] ")).trim().toLowerCase();
    rl.close();
    if (answer !== "y" && answer !== "yes") {
      console.log("Nothing changed.");
      process.exit(1);
    }
  }
  try {
    await execute(steps, api);
  } catch (e) {
    console.error(`\nsetup stopped: ${e instanceof Error ? e.message : String(e)}`);
    console.log(`\n${formatReport(doctorReport(await gatherProduction(api)))}`);
    process.exit(1);
  }
  const checks = doctorReport(await gatherProduction(api));
  console.log(`\n${formatReport(checks)}`);
  console.log("\nNext: commit wrangler.jsonc (the D1 id, AUD and Client ID are not secrets; .prod/ stays uncommitted), then run `npm run prod:verify`.");
  process.exit(checks.some((c) => c.status !== "ok") ? 1 : 0);
}
