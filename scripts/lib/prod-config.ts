// Production facts for PlacesSync on Nitish's Cloudflare account (Workers Free plan,
// Zero Trust Free), shared by prod-setup, prod-doctor and prod-verify. Nothing here is a
// secret: the account id, workers.dev subdomain, team domain and One-time PIN login id
// appear in every URL and token the deployment serves. Values Cloudflare creates at setup
// time (the D1 database id, the Access application's AUD tag and the verification service
// token's Client ID) and the Workers AI provider setting are written into wrangler.jsonc by
// `npm run prod:setup`, never typed by hand. The service token's secret is never here: it
// lives in the gitignored .prod/ folder (service-token-file.ts).
import { readFileSync } from "node:fs";
import path from "node:path";
import { SERVICE_PRINCIPAL_ID } from "../../src/shared/service-principal.ts";
import { ROOT } from "./meta.ts";

export const PROD = {
  accountId: "dc93c3bc8aa4f9e09a0d7e7354a80873",
  workersSubdomain: "nitish-ratakonda",
  teamDomain: "https://old-truth-a7dc.cloudflareaccess.com",
  /** wrangler names the Worker <name>-<env>: "placessync" + "production". */
  workerName: "placessync-production",
  d1Name: "placessync",
  workflowName: "placessync-triage",
  accessAppName: "placessync-production",
  accessPolicyName: "placessync-owner-and-personas",
  /** The account's existing One-time PIN login; setup only references it, never creates one. */
  otpIdpId: "743683e8-42d4-44e9-9991-ba57a1bb0dec",
  /** Access service token prod-verify signs in with, and its Service Auth policy. */
  serviceTokenName: "placessync-verify",
  servicePolicyName: "placessync-verify-service-auth",
  /** One year, Access's default; `npm run prod:doctor` warns 30 days before it expires. */
  serviceTokenDuration: "8760h",
  /** Matches the 8-hour dev tokens; role changes reach open sockets within this. */
  sessionDuration: "8h",
  model: "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
  siteId: "hq",
} as const;

export const PROD_HOST = `${PROD.workerName}.${PROD.workersSubdomain}.workers.dev`;
export const PROD_URL = `https://${PROD_HOST}`;

/** The value prod-setup replaces. It contains SET_ME, so config.ts fails closed on it. */
export const PLACEHOLDER = "SET_ME_BY_npm_run_prod_setup";

export type PersonaRole = "facilities_admin" | "facilities_staff" | "employee";

export interface Persona {
  id: string;
  email: string;
  role: PersonaRole;
  displayName: string;
  department: string;
}

/**
 * Who may sign in through Access (One-time PIN to each address). The owner is the
 * facilities admin; plus-addresses of the same inbox are the staff and employee personas.
 * Each address that signs in takes one Zero Trust seat.
 */
export const PERSONAS: readonly Persona[] = [
  { id: "emp_admin", email: "nitishsancs@gmail.com", role: "facilities_admin", displayName: "Nitish Chowdary", department: "Facilities" },
  { id: "emp_staff", email: "nitishsancs+staff@gmail.com", role: "facilities_staff", displayName: "Facilities Staff (persona)", department: "Facilities" },
  { id: "emp_employee", email: "nitishsancs+employee@gmail.com", role: "employee", displayName: "Employee (persona)", department: "Engineering" },
];

export const OWNER = PERSONAS[0] as Persona;

/**
 * The employee prod-verify acts as, through the service token (src/worker/auth/service-token.ts).
 * Its address is in the reserved .invalid domain, so no person can sign in as it, and it
 * is not in the Allow policy: only the Service Auth policy reaches it.
 */
export const VERIFY_PRINCIPAL: Persona = {
  id: SERVICE_PRINCIPAL_ID,
  email: "placessync-verify@service-token.invalid",
  role: "employee",
  displayName: "Production verification (service token)",
  department: "Verification",
};

/** Every employee row the production seed writes. */
export const SEED_PEOPLE: readonly Persona[] = [...PERSONAS, VERIFY_PRINCIPAL];

// ---------- wrangler.jsonc ----------

export const WRANGLER_CONFIG = path.join(ROOT, "wrangler.jsonc");

/** Removes // and block comments outside strings, then trailing commas, so JSON.parse reads JSONC. */
export function parseJsonc(text: string): unknown {
  let out = "";
  let inString = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i] as string;
    const next = text[i + 1];
    if (inString) {
      out += ch;
      if (ch === "\\") {
        out += next ?? "";
        i++;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
      out += ch;
    } else if (ch === "/" && next === "/") {
      while (i < text.length && text[i] !== "\n") i++;
      out += "\n";
    } else if (ch === "/" && next === "*") {
      i += 2;
      while (i < text.length && !(text[i] === "*" && text[i + 1] === "/")) i++;
      i++;
    } else {
      out += ch;
    }
  }
  return JSON.parse(out.replace(/,(\s*[}\]])/g, "$1"));
}

export interface ProductionValues {
  accountId: string | undefined;
  databaseName: string | undefined;
  databaseId: string | undefined;
  teamDomain: string | undefined;
  accessAud: string | undefined;
  serviceClientId: string | undefined;
  triageProvider: string | undefined;
  workersDev: boolean | undefined;
  previewUrls: boolean | undefined;
  vars: Record<string, string>;
}

interface RawProductionEnv {
  account_id?: string;
  workers_dev?: boolean;
  preview_urls?: boolean;
  d1_databases?: { database_name?: string; database_id?: string }[];
  vars?: Record<string, string>;
}

export function readProductionValues(text: string): ProductionValues {
  const cfg = parseJsonc(text) as { env?: { production?: RawProductionEnv } };
  const prod = cfg.env?.production;
  if (!prod) throw new Error("wrangler.jsonc has no env.production");
  const db = prod.d1_databases?.[0];
  return {
    accountId: prod.account_id,
    databaseName: db?.database_name,
    databaseId: db?.database_id,
    teamDomain: prod.vars?.ACCESS_TEAM_DOMAIN,
    accessAud: prod.vars?.ACCESS_AUD,
    serviceClientId: prod.vars?.ACCESS_SERVICE_CLIENT_ID,
    triageProvider: prod.vars?.TRIAGE_PROVIDER,
    workersDev: prod.workers_dev,
    previewUrls: prod.preview_urls,
    vars: prod.vars ?? {},
  };
}

export function readWranglerConfig(file: string = WRANGLER_CONFIG): string {
  return readFileSync(file, "utf8");
}

export const isPlaceholder = (v: string | undefined): boolean => !v || v.includes("SET_ME") || v.includes("REPLACE_WITH");

const D1_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
/** Access AUD tags are 64 hex characters. */
const AUD = /^[0-9a-f]{64}$/;
/** Service token Client IDs end in .access (config.ts accepts the same shape). */
const CLIENT_ID = /^[A-Za-z0-9_-]+\.access$/;

export function isD1Id(v: string): boolean {
  return D1_ID.test(v);
}

export function isAccessAud(v: string): boolean {
  return AUD.test(v);
}

export function isServiceClientId(v: string): boolean {
  return CLIENT_ID.test(v);
}

export type ProductionKey = "database_id" | "ACCESS_AUD" | "ACCESS_SERVICE_CLIENT_ID" | "TRIAGE_PROVIDER";

/**
 * Sets one value inside env.production only (the top-level local D1 id is never touched)
 * and returns the new text with formatting and comments kept. Refuses values that do not
 * look like what Cloudflare issues, so a typo cannot be written.
 */
export function setProductionValue(text: string, key: ProductionKey, value: string): string {
  if (key === "database_id" && !isD1Id(value)) throw new Error(`refusing to write database_id ${JSON.stringify(value)}: not a D1 UUID`);
  if (key === "ACCESS_AUD" && !isAccessAud(value)) throw new Error("refusing to write ACCESS_AUD: not a 64-character hex AUD tag");
  if (key === "ACCESS_SERVICE_CLIENT_ID" && !isServiceClientId(value)) throw new Error("refusing to write ACCESS_SERVICE_CLIENT_ID: not a service token Client ID");
  if (key === "TRIAGE_PROVIDER" && value !== "workers-ai") throw new Error("refusing to write TRIAGE_PROVIDER: production uses workers-ai");
  const start = text.search(/"production"\s*:\s*\{/);
  if (start < 0) throw new Error("wrangler.jsonc has no env.production block");
  const head = text.slice(0, start);
  const tail = text.slice(start);
  const re = new RegExp(`("${key}"\\s*:\\s*")([^"]*)(")`);
  if (!re.test(tail)) throw new Error(`env.production has no ${key}`);
  return head + tail.replace(re, (_m, a: string, _old: string, c: string) => `${a}${value}${c}`);
}
