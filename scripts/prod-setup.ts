// Production setup for PlacesSync on the Workers Free plan: one idempotent command that
// creates or converges every Cloudflare resource, then deploys. Rerunning it changes only
// what is missing or different. It reads state first (the same read-only calls as
// prod:doctor), prints the plan, and asks before changing anything (--yes skips the
// question, --plan prints the plan and exits).
//
//   npx wrangler login                     once; setup uses wrangler's OAuth for Workers and D1
//   export PLACESSYNC_CF_API_TOKEN=...      account API token for Access (README lists permissions)
//   npm run prod:setup                     plan, confirm, apply
//   npm run prod:setup -- --plan           plan only, changes nothing
//
// Runbook (each step is skipped when already done):
//   1. Check wrangler is logged in to account dc93c3bc...; with the token, check the Zero
//      Trust team is old-truth-a7dc and the workers.dev subdomain is nitish-ratakonda.
//   2. D1: create `placessync` if missing; write its id into wrangler.jsonc env.production.
//   3. Apply migrations/ to it (`wrangler d1 migrations apply --remote`).
//   4. Seed the catalog and the owner and persona sign-ins (.seed/catalog.sql, idempotent).
//   Without the token, setup stops here: nothing is deployed until Access can be set up.
//   5. First deploy only if the Worker does not exist yet. ACCESS_AUD is still the
//      placeholder, so every API route answers 500 misconfigured (fail-closed).
//   6. Access: the One-time PIN login (if the account has none), the reusable policy
//      `placessync-owner-and-personas` allowing exactly the owner and persona emails, and a
//      self-hosted application for placessync-production.nitish-ratakonda.workers.dev that
//      uses only that login and that policy. Write its AUD into wrangler.jsonc.
//   7. Deploy (`npm run deploy`), so the running version carries the AUD.
//   8. `npm run build` to put the local build back (the production build replaced dist/).
//   9. Probe: an unauthenticated GET /api/health must redirect to the team's sign-in page.
//  10. Print the doctor report. Then: commit wrangler.jsonc, and run `npm run prod:verify`.
//
// The token is read from the environment and never printed or written anywhere.
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createInterface } from "node:readline/promises";
import { parseArgs } from "node:util";
import { catalogSql } from "./export-catalog-sql.ts";
import { type AccessAction, DESIRED, appBody, findApp, findOtp, findPolicy, otpBody, planAccess, policyBody } from "./lib/access-plan.ts";
import { CfApi, TOKEN_PERMISSIONS, tokenFromEnv } from "./lib/cf-api.ts";
import { ROOT } from "./lib/meta.ts";
import {
  PERSONAS,
  PROD,
  PROD_URL,
  WRANGLER_CONFIG,
  isPlaceholder,
  readProductionValues,
  readWranglerConfig,
  setProductionValue,
} from "./lib/prod-config.ts";
import { type ProdState, doctorReport, formatReport, gatherState } from "./lib/prod-state.ts";
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
  | { kind: "deploy" }
  | { kind: "restore-local-build" }
  | { kind: "probe" };

/** The ordered steps for this state. A "stop" step ends the run before anything after it. */
export function planSetup(s: ProdState): Step[] {
  const steps: Step[] = [];
  if (!s.whoami.ok || !s.whoami.value.loggedIn || !s.whoami.value.accountIds.includes(PROD.accountId)) {
    return [{ kind: "stop", reason: `wrangler must be logged in to account ${PROD.accountId}: run npx wrangler login` }];
  }
  if (s.token) {
    if (s.teamDomain && !s.teamDomain.ok) return [{ kind: "stop", reason: `cannot read the Zero Trust organization: ${s.teamDomain.reason}` }];
    if (s.teamDomain?.ok && s.teamDomain.value !== PROD.teamDomain) {
      return [{ kind: "stop", reason: `the token's account has Zero Trust team ${s.teamDomain.value}, expected ${PROD.teamDomain}` }];
    }
    if (s.subdomain?.ok && s.subdomain.value !== PROD.workersSubdomain) {
      return [{ kind: "stop", reason: `the account's workers.dev subdomain is ${s.subdomain.value ?? "unset"}, expected ${PROD.workersSubdomain}` }];
    }
  }
  if (!s.d1.ok) return [{ kind: "stop", reason: `cannot list D1 databases: ${s.d1.reason}` }];
  const cfgId = s.config.databaseId;
  if (s.d1.value === null) {
    if (cfgId && !isPlaceholder(cfgId)) return [{ kind: "stop", reason: `wrangler.jsonc names D1 database ${cfgId}, but the account has no ${PROD.d1Name}; fix wrangler.jsonc by hand` }];
    steps.push({ kind: "create-d1" }, { kind: "write-d1-id" });
  } else if (cfgId !== s.d1.value.uuid) {
    if (cfgId && !isPlaceholder(cfgId)) {
      return [{ kind: "stop", reason: `wrangler.jsonc names D1 database ${cfgId}, but the account's ${PROD.d1Name} is ${s.d1.value.uuid}; fix wrangler.jsonc by hand` }];
    }
    steps.push({ kind: "write-d1-id", uuid: s.d1.value.uuid });
  }
  steps.push({ kind: "apply-migrations" }, { kind: "seed-catalog" });

  if (!s.token) {
    steps.push({
      kind: "stop",
      reason: "no account API token (PLACESSYNC_CF_API_TOKEN or CF_SETUP_TOKEN), so Access cannot be set up; nothing is deployed until it can. Export the token and rerun.",
    });
    return steps;
  }
  if (!s.idps?.ok || !s.policies?.ok || !s.apps?.ok) {
    const why = [s.idps, s.policies, s.apps].find((r) => r && !r.ok) as { reason: string } | undefined;
    steps.push({ kind: "stop", reason: `cannot read Access settings: ${why?.reason ?? "unknown"}` });
    return steps;
  }
  const deployed = s.deployments.ok && s.deployments.value > 0;
  const app = findApp(s.apps.value);
  // The Worker exists before its Access application is created, in case Access checks the
  // hostname; until the AUD is written it fails closed.
  if (!deployed && !app) steps.push({ kind: "first-deploy" });
  for (const action of planAccess({ idps: s.idps.value, policies: s.policies.value, apps: s.apps.value })) steps.push({ kind: "access", action });
  if (!app || app.aud !== s.config.accessAud) steps.push({ kind: "write-aud" });
  steps.push({ kind: "deploy" }, { kind: "restore-local-build" }, { kind: "probe" });
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
      return `seed the site, 20 resources and ${PERSONAS.length} sign-ins (${PERSONAS.map((p) => `${p.email} as ${p.role}`).join(", ")}); idempotent`;
    case "first-deploy":
      return `first deploy of ${PROD.workerName}, fail-closed (ACCESS_AUD is still the placeholder, so the API answers 500)`;
    case "access": {
      const a = step.action;
      if (a.kind === "create-otp") return `create the One-time PIN login (${PROD.otpIdpName})`;
      if (a.kind === "create-policy") return `create reusable Access policy ${DESIRED.policyName} allowing ${DESIRED.emails.join(", ")}`;
      if (a.kind === "update-policy") return `update Access policy ${DESIRED.policyName}: ${a.drift.join("; ")}`;
      if (a.kind === "create-app") return `create self-hosted Access application ${DESIRED.appName} for ${DESIRED.host} (One-time PIN only, ${DESIRED.sessionDuration} sessions)`;
      return `update Access application ${DESIRED.appName}: ${a.drift.join("; ")}`;
    }
    case "write-aud":
      return "write the Access application's AUD into wrangler.jsonc ACCESS_AUD";
    case "deploy":
      return `deploy ${PROD.workerName} (npm run deploy)`;
    case "restore-local-build":
      return "npm run build (the production build replaced dist/)";
    case "probe":
      return `check that an unauthenticated GET ${PROD_URL}/api/health redirects to ${PROD.teamDomain}`;
  }
}

function must(r: { code: number; stdout: string; stderr: string }, what: string): void {
  if (r.code !== 0) throw new Error(`${what} failed: ${lastLine(r)}`);
}

function writeConfigValue(key: "database_id" | "ACCESS_AUD", value: string): boolean {
  const before = readWranglerConfig();
  const after = setProductionValue(before, key, value);
  if (after === before) return false;
  writeFileSync(WRANGLER_CONFIG, after);
  return true;
}

async function execute(steps: Step[], api: CfApi | null): Promise<void> {
  let otpId: string | null = null;
  let policyId: string | null = null;
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
        writeFileSync(file, `${catalogSql(PERSONAS, new Date().toISOString())}\n`);
        must(await wrangler(["d1", "execute", "DB", "--remote", ...PROD_ENV_ARGS, "--file", path.relative(ROOT, file), "--yes"], { inherit: true }), "wrangler d1 execute (catalog)");
        break;
      }
      case "first-deploy":
      case "deploy":
        must(await run("npm", ["run", "deploy"], { inherit: true }), "npm run deploy");
        break;
      case "access": {
        if (!api) throw new Error("Access steps need the account API token");
        const a = step.action;
        if (a.kind === "create-otp") {
          otpId = (await api.createIdentityProvider(otpBody())).id;
        } else if (a.kind === "create-policy") {
          policyId = (await api.createAccessPolicy(policyBody())).id;
        } else if (a.kind === "update-policy") {
          const p = findPolicy(await api.accessPolicies());
          if (!p) throw new Error("policy disappeared");
          policyId = (await api.updateAccessPolicy(p.id, policyBody())).id;
        } else {
          otpId ??= findOtp(await api.identityProviders())?.id ?? null;
          policyId ??= findPolicy(await api.accessPolicies())?.id ?? null;
          if (!otpId || !policyId) throw new Error("the One-time PIN login and the policy must exist before the application");
          const body = appBody(otpId, policyId);
          if (a.kind === "create-app") await api.createAccessApp(body);
          else {
            const app = findApp(await api.accessApps());
            if (!app) throw new Error("application disappeared");
            await api.updateAccessApp(app.id, body);
          }
        }
        console.log("done");
        break;
      }
      case "write-aud": {
        if (!api) throw new Error("reading the AUD needs the account API token");
        const app = findApp(await api.accessApps());
        if (!app) throw new Error(`no Access application protects ${DESIRED.host}`);
        console.log(writeConfigValue("ACCESS_AUD", app.aud) ? "wrangler.jsonc: ACCESS_AUD set (the AUD tag is not a secret)" : "wrangler.jsonc already has it");
        break;
      }
      case "restore-local-build":
        must(await run("npm", ["run", "build"], { inherit: true }), "npm run build");
        break;
      case "probe": {
        // Access settings can take a little while to reach the edge.
        const deadline = Date.now() + 120_000;
        for (;;) {
          const res = await fetch(`${PROD_URL}/api/health`, { redirect: "manual" });
          await res.body?.cancel();
          const location = res.headers.get("location") ?? "";
          if (res.status >= 300 && res.status < 400 && location.startsWith(`${PROD.teamDomain}/`)) {
            console.log(`redirected to ${new URL(location).origin} sign-in (${res.status})`);
            break;
          }
          if (Date.now() > deadline) throw new Error(`GET /api/health still answers ${res.status} without credentials; Access is not in front of the Worker`);
          await new Promise((r) => setTimeout(r, 5_000));
        }
        break;
      }
    }
  }
}

if (import.meta.main) {
  const { values } = parseArgs({ options: { plan: { type: "boolean", default: false }, yes: { type: "boolean", default: false } } });
  const token = tokenFromEnv();
  const api = token ? new CfApi(PROD.accountId, token) : null;
  const gather = () => gatherState({ wrangler, api, fetchImpl: fetch, config: readProductionValues(readWranglerConfig()) });
  console.log(`PlacesSync production setup: account ${PROD.accountId}, ${PROD_URL}${token ? ", account API token present (not printed)" : ", no account API token"}`);
  const steps = planSetup(await gather());
  console.log("\nPlan:");
  steps.forEach((s, i) => console.log(`  ${i + 1}. ${describeStep(s)}`));
  if (!token) console.log(`\nThe token needs:\n${TOKEN_PERMISSIONS.map((p) => `  - ${p}`).join("\n")}`);
  if (values.plan) process.exit(0);
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
    console.log(`\n${formatReport(doctorReport(await gather()))}`);
    process.exit(1);
  }
  const checks = doctorReport(await gather());
  console.log(`\n${formatReport(checks)}`);
  console.log("\nNext: commit wrangler.jsonc (the D1 id and AUD are not secrets), then run `cloudflared access login " + PROD_URL + "` and `npm run prod:verify`.");
  process.exit(checks.some((c) => c.status !== "ok") ? 1 : 0);
}
