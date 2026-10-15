// Reads the production state with read-only calls only (wrangler list/info/execute SELECT,
// Cloudflare API GETs, one unauthenticated GET of the Worker URL) and turns it into the
// doctor's report. prod-setup gathers the same state to decide what to create.
import { CfApi, CfApiError, type AccessApp, type AccessPolicy, type IdentityProvider } from "./cf-api.ts";
import { DESIRED, appDrift, findApp, findOtp, findPolicy, policyDrift } from "./access-plan.ts";
import { PERSONAS, PROD, PROD_URL, type ProductionValues, isAccessAud, isD1Id, isPlaceholder } from "./prod-config.ts";
import { PROD_ENV_ARGS, type Runner, findD1, lastLine, parseExecuteRows, parsePendingMigrations, parseJsonOutput, parseWhoami } from "./wrangler-cli.ts";

/** A value that was read, or why it could not be. */
export type Read<T> = { ok: true; value: T } | { ok: false; reason: string };

const ok = <T>(value: T): Read<T> => ({ ok: true, value });
const fail = <T>(reason: string): Read<T> => ({ ok: false, reason });

async function attempt<T>(fn: () => Promise<T>): Promise<Read<T>> {
  try {
    return ok(await fn());
  } catch (e) {
    return fail(e instanceof Error ? e.message : String(e));
  }
}

export interface CatalogState {
  sites: number;
  resources: number;
  people: { email: string; role: string; active: number }[];
}

export interface ProdState {
  config: ProductionValues;
  whoami: Read<{ loggedIn: boolean; email: string | null; accountIds: string[] }>;
  d1: Read<{ uuid: string } | null>;
  pendingMigrations: Read<string[]> | null;
  catalog: Read<CatalogState> | null;
  deployments: Read<number>;
  workflow: Read<boolean>;
  model: Read<boolean>;
  token: boolean;
  teamDomain: Read<string> | null;
  subdomain: Read<string | null> | null;
  idps: Read<IdentityProvider[]> | null;
  policies: Read<AccessPolicy[]> | null;
  apps: Read<AccessApp[]> | null;
  accountCrons: Read<{ script: string; crons: string[] }[]> | null;
  probe: Read<{ status: number; location: string | null; server: string | null }>;
}

export interface GatherDeps {
  wrangler: Runner;
  api: CfApi | null;
  fetchImpl: typeof fetch;
  config: ProductionValues;
}

export const CATALOG_QUERY =
  "SELECT (SELECT COUNT(*) FROM sites) AS sites, (SELECT COUNT(*) FROM resources) AS resources, (SELECT json_group_array(json_object('email', email, 'role', role, 'active', active)) FROM employees) AS people";

export async function gatherState(deps: GatherDeps): Promise<ProdState> {
  const { wrangler, api, config } = deps;
  const whoami = await attempt(async () => parseWhoami(await wrangler(["whoami", "--json"])));
  const loggedIn = whoami.ok && whoami.value.loggedIn && whoami.value.accountIds.includes(PROD.accountId);
  const notLoggedIn = "wrangler is not logged in to the production account";

  const d1: Read<{ uuid: string } | null> = loggedIn ? await attempt(async () => findD1(await wrangler(["d1", "list", "--json"]), PROD.d1Name)) : fail(notLoggedIn);
  const d1Ready = d1.ok && d1.value !== null && config.databaseId === d1.value.uuid;
  const pendingMigrations = d1Ready ? await attempt(async () => parsePendingMigrations(await wrangler(["d1", "migrations", "list", "DB", "--remote", ...PROD_ENV_ARGS]))) : null;
  const catalog =
    d1Ready && pendingMigrations?.ok && pendingMigrations.value.length === 0
      ? await attempt(async () => {
          const [row] = parseExecuteRows<{ sites: number; resources: number; people: string }>(
            await wrangler(["d1", "execute", "DB", "--remote", ...PROD_ENV_ARGS, "--json", "--command", CATALOG_QUERY]),
          );
          return { sites: Number(row?.sites ?? 0), resources: Number(row?.resources ?? 0), people: JSON.parse(row?.people ?? "[]") as CatalogState["people"] };
        })
      : null;
  const deployments: Read<number> = loggedIn
    ? await attempt(async () => {
        const r = await wrangler(["deployments", "list", "--name", PROD.workerName, "--json"]);
        if (r.code !== 0) {
          // A Worker that was never deployed is reported as an error by the API (code 10007).
          if (/10007|not found|does not exist/i.test(`${r.stdout}${r.stderr}`)) return 0;
          throw new Error(lastLine(r));
        }
        return parseJsonOutput<unknown[]>(r.stdout).length;
      })
    : fail(notLoggedIn);
  const workflow: Read<boolean> = loggedIn
    ? await attempt(async () => {
        const r = await wrangler(["workflows", "list", "--json"]);
        if (r.code !== 0) throw new Error(lastLine(r));
        return parseJsonOutput<{ name: string }[]>(r.stdout).some((w) => w.name === PROD.workflowName);
      })
    : fail(notLoggedIn);
  const model: Read<boolean> = loggedIn
    ? await attempt(async () => {
        const r = await wrangler(["ai", "models", "list", "--json"]);
        if (r.code !== 0) throw new Error(lastLine(r));
        return parseJsonOutput<{ name: string }[]>(r.stdout).some((m) => m.name === PROD.model);
      })
    : fail(notLoggedIn);

  const viaApi = <T>(fn: (a: CfApi) => Promise<T>): Promise<Read<T>> | null => (api ? attempt(() => fn(api)) : null);
  const teamDomain = await viaApi(async (a) => `https://${(await a.organization()).auth_domain}`);
  const subdomain = await viaApi((a) => a.workersSubdomain());
  const idps = await viaApi((a) => a.identityProviders());
  const policies = await viaApi((a) => a.accessPolicies());
  const apps = await viaApi((a) => a.accessApps());
  const accountCrons = await viaApi(async (a) => {
    const scripts = await a.workerScripts();
    const out: { script: string; crons: string[] }[] = [];
    for (const s of scripts) out.push({ script: s.id, crons: await a.scriptCrons(s.id) });
    return out;
  });

  const probe = await attempt(async () => {
    const res = await deps.fetchImpl(`${PROD_URL}/api/health`, { redirect: "manual" });
    await res.body?.cancel();
    return { status: res.status, location: res.headers.get("location"), server: res.headers.get("server") };
  });

  return { config, whoami, d1, pendingMigrations, catalog, deployments, workflow, model, token: api !== null, teamDomain, subdomain, idps, policies, apps, accountCrons, probe };
}

// ---------- the report ----------

export type CheckStatus = "ok" | "missing" | "unknown";

export interface Check {
  id: string;
  status: CheckStatus;
  detail: string;
  fix?: string;
}

const SETUP = "npm run prod:setup";
const permissionHint = (r: { ok: false; reason: string }) => (/HTTP 403|10000|9109/.test(r.reason) ? " (the token lacks a permission; see the README's token list)" : "");

/** Cron Triggers per account on Workers Free (https://developers.cloudflare.com/workers/platform/limits/). */
export const FREE_CRONS_PER_ACCOUNT = 5;

export function doctorReport(s: ProdState): Check[] {
  const c: Check[] = [];
  const add = (id: string, status: CheckStatus, detail: string, fix?: string) => c.push({ id, status, detail, ...(fix ? { fix } : {}) });
  const cfg = s.config;

  // Local config.
  add("config.account", cfg.accountId === PROD.accountId ? "ok" : "missing", `env.production.account_id = ${cfg.accountId ?? "unset"}`, `set it to ${PROD.accountId}`);
  add("config.team-domain", cfg.teamDomain === PROD.teamDomain ? "ok" : "missing", `ACCESS_TEAM_DOMAIN = ${cfg.teamDomain ?? "unset"}`, `set it to ${PROD.teamDomain}`);
  add("config.d1-id", cfg.databaseId && isD1Id(cfg.databaseId) ? "ok" : "missing", `env.production database_id = ${cfg.databaseId ?? "unset"}`, SETUP);
  add(
    "config.access-aud",
    cfg.accessAud && !isPlaceholder(cfg.accessAud) && isAccessAud(cfg.accessAud) ? "ok" : "missing",
    isPlaceholder(cfg.accessAud) ? "ACCESS_AUD is the placeholder, so the Worker answers 500 misconfigured (fail-closed)" : "ACCESS_AUD is set",
    SETUP,
  );

  // wrangler.
  if (!s.whoami.ok || !s.whoami.value.loggedIn) add("wrangler.login", "missing", "wrangler is not logged in", "npx wrangler login");
  else if (!s.whoami.value.accountIds.includes(PROD.accountId)) add("wrangler.login", "missing", `logged in as ${s.whoami.value.email}, without account ${PROD.accountId}`, "npx wrangler login with the account owner");
  else add("wrangler.login", "ok", `logged in as ${s.whoami.value.email}`);

  if (!s.d1.ok) add("d1.database", "unknown", s.d1.reason);
  else if (!s.d1.value) add("d1.database", "missing", `no D1 database named ${PROD.d1Name}`, SETUP);
  else if (s.d1.value.uuid !== cfg.databaseId) add("d1.database", "missing", `${PROD.d1Name} is ${s.d1.value.uuid}, but wrangler.jsonc says ${cfg.databaseId}`, SETUP);
  else add("d1.database", "ok", `${PROD.d1Name} = ${s.d1.value.uuid}`);

  if (s.pendingMigrations === null) add("d1.migrations", "unknown", "not checked until the database exists and is configured");
  else if (!s.pendingMigrations.ok) add("d1.migrations", "unknown", s.pendingMigrations.reason);
  else if (s.pendingMigrations.value.length) add("d1.migrations", "missing", `unapplied: ${s.pendingMigrations.value.join(", ")}`, SETUP);
  else add("d1.migrations", "ok", "all migrations applied");

  if (s.catalog === null) add("d1.catalog", "unknown", "not checked until migrations are applied");
  else if (!s.catalog.ok) add("d1.catalog", "unknown", s.catalog.reason);
  else {
    const cat = s.catalog.value;
    const missingPeople = PERSONAS.filter((p) => !cat.people.some((q) => q.email.toLowerCase() === p.email.toLowerCase() && q.role === p.role && Number(q.active) === 1));
    const good = cat.sites === 1 && cat.resources === 20 && missingPeople.length === 0;
    add(
      "d1.catalog",
      good ? "ok" : "missing",
      `${cat.sites} site, ${cat.resources} resources, ${cat.people.length} people${missingPeople.length ? `; missing or wrong role: ${missingPeople.map((p) => p.email).join(", ")}` : ""}`,
      SETUP,
    );
  }

  if (!s.deployments.ok) add("worker.deployed", "unknown", s.deployments.reason);
  else add("worker.deployed", s.deployments.value > 0 ? "ok" : "missing", s.deployments.value > 0 ? `${PROD.workerName} has ${s.deployments.value} recent deployment(s)` : `${PROD.workerName} was never deployed`, SETUP);

  if (!s.workflow.ok) add("worker.workflow", "unknown", s.workflow.reason);
  else add("worker.workflow", s.workflow.value ? "ok" : "missing", s.workflow.value ? `${PROD.workflowName} exists` : `no Workflow ${PROD.workflowName} (created by the first deploy)`, SETUP);

  if (!s.model.ok) add("workers-ai.model", "unknown", s.model.reason);
  else add("workers-ai.model", s.model.value ? "ok" : "missing", s.model.value ? `${PROD.model} is in the Workers AI catalog` : `${PROD.model} is not in the catalog`, "pick another JSON-mode model and set TRIAGE_MODEL");

  // Cloudflare API (needs the token).
  if (!s.token) {
    add("api.token", "missing", "no account API token in CF_API_TOKEN, so Access, the subdomain and the account's crons are unchecked", "export CF_API_TOKEN (permissions in the README)");
  } else {
    add("api.token", "ok", "account API token present (not printed)");
    const t = s.teamDomain;
    if (t && !t.ok) add("access.team", "unknown", t.reason + permissionHint(t));
    else if (t?.ok) add("access.team", t.value === PROD.teamDomain ? "ok" : "missing", `Zero Trust team domain ${t.value}`, `the token's account has team ${t.value}, expected ${PROD.teamDomain}`);

    const sd = s.subdomain;
    if (sd && !sd.ok) add("workers.subdomain", "unknown", sd.reason + permissionHint(sd));
    else if (sd?.ok) add("workers.subdomain", sd.value === PROD.workersSubdomain ? "ok" : "missing", `workers.dev subdomain ${sd.value ?? "none"}`, `expected ${PROD.workersSubdomain}.workers.dev`);

    if (s.idps && !s.idps.ok) add("access.otp", "unknown", s.idps.reason + permissionHint(s.idps));
    else if (s.idps?.ok) {
      const otp = findOtp(s.idps.value);
      add("access.otp", otp ? "ok" : "missing", otp ? `One-time PIN login ${otp.name}` : "no One-time PIN login method", SETUP);
    }

    let policy: AccessPolicy | null = null;
    if (s.policies && !s.policies.ok) add("access.policy", "unknown", s.policies.reason + permissionHint(s.policies));
    else if (s.policies?.ok) {
      policy = findPolicy(s.policies.value);
      const drift = policy ? policyDrift(policy) : [];
      add("access.policy", policy && drift.length === 0 ? "ok" : "missing", policy ? (drift.length ? drift.join("; ") : `${DESIRED.policyName} allows ${DESIRED.emails.length} emails`) : `no reusable policy ${DESIRED.policyName}`, SETUP);
    }

    if (s.apps && !s.apps.ok) add("access.app", "unknown", s.apps.reason + permissionHint(s.apps));
    else if (s.apps?.ok) {
      let app: AccessApp | null = null;
      try {
        app = findApp(s.apps.value);
      } catch (e) {
        add("access.app", "missing", e instanceof Error ? e.message : String(e), "delete the extra application in Zero Trust");
      }
      if (app) {
        const otp = s.idps?.ok ? findOtp(s.idps.value) : null;
        const drift = otp && policy ? appDrift(app, otp.id, policy.id) : ["login method or policy missing"];
        add("access.app", drift.length ? "missing" : "ok", drift.length ? drift.join("; ") : `${app.name} protects ${DESIRED.host}`, SETUP);
        add("access.aud", app.aud === cfg.accessAud ? "ok" : "missing", app.aud === cfg.accessAud ? "wrangler.jsonc ACCESS_AUD matches the application" : "wrangler.jsonc ACCESS_AUD differs from the application's AUD", SETUP);
      } else if (!c.some((x) => x.id === "access.app")) {
        add("access.app", "missing", `no Access application protects ${DESIRED.host}`, SETUP);
      }
    }

    const ac = s.accountCrons;
    if (ac && !ac.ok) add("free.crons", "unknown", ac.reason + permissionHint(ac));
    else if (ac?.ok) {
      const others = ac.value.filter((x) => x.script !== PROD.workerName).reduce((n, x) => n + x.crons.length, 0);
      const total = others + 1;
      add("free.crons", total <= FREE_CRONS_PER_ACCOUNT ? "ok" : "missing", `${total} of ${FREE_CRONS_PER_ACCOUNT} Cron Triggers on the account with this Worker's one (${others} from other Workers)`, "remove a Cron Trigger elsewhere; Free allows 5 per account");
    }
  }

  // The edge.
  if (!s.probe.ok) add("edge.access", "unknown", `GET ${PROD_URL}/api/health failed: ${s.probe.reason}`);
  else {
    const { status, location } = s.probe.value;
    const toTeam = location?.startsWith(`${PROD.teamDomain}/`) ?? false;
    if ((status === 302 || status === 301 || status === 303) && toTeam) add("edge.access", "ok", `unauthenticated GET /api/health is redirected to the ${PROD.teamDomain} sign-in`);
    else if (status === 404) add("edge.access", "missing", "no Worker answers on the workers.dev hostname yet (404)", SETUP);
    else add("edge.access", "missing", `unauthenticated GET /api/health returned ${status}${location ? ` to ${location}` : ""}: Access is not in front of the Worker`, SETUP);
  }
  return c;
}

export function formatReport(checks: readonly Check[]): string {
  const width = Math.max(...checks.map((c) => c.id.length));
  return checks
    .map((c) => `${`[${c.status}]`.padEnd(10)}${c.id.padEnd(width + 2)}${c.detail}${c.status !== "ok" && c.fix ? `\n${" ".repeat(width + 12)}fix: ${c.fix}` : ""}`)
    .join("\n");
}

export function isPermissionError(e: unknown): boolean {
  return e instanceof CfApiError && e.isPermission;
}
