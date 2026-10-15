// The committed production environment (wrangler.jsonc env.production): the values known
// before any cloud resource exists are filled in, the two that Cloudflare issues at setup
// are placeholders that keep the Worker fail-closed, and nothing in it needs Workers Paid.
import { describe, expect, it } from "vitest";
import {
  PERSONAS,
  PLACEHOLDER,
  PROD,
  PROD_HOST,
  isPlaceholder,
  parseJsonc,
  readProductionValues,
  readWranglerConfig,
  setProductionValue,
} from "../../scripts/lib/prod-config.ts";
import { parseConfig } from "../../src/worker/config.ts";

const text = readWranglerConfig();
const cfg = parseJsonc(text) as Record<string, unknown> & { env: { production: Record<string, unknown> } };
const prod = readProductionValues(text);
const AUD = "a".repeat(64);
const D1 = "0f0e0d0c-0b0a-4908-8706-050403020100";

describe("wrangler.jsonc env.production", () => {
  it("carries the account, workers.dev and Access values known before setup", () => {
    expect(prod.accountId).toBe(PROD.accountId);
    expect(prod.teamDomain).toBe(PROD.teamDomain);
    expect(prod.databaseName).toBe(PROD.d1Name);
    expect(prod.workersDev).toBe(true);
    // Hostname-based Access protects only the exact hostname, so no preview URLs.
    expect(prod.previewUrls).toBe(false);
    expect(`${cfg.name as string}-production.${PROD.workersSubdomain}.workers.dev`).toBe(PROD_HOST);
  });

  it("leaves the D1 id and the Access AUD to prod-setup, and fails closed until then", () => {
    expect(prod.databaseId).toBe(PLACEHOLDER);
    expect(prod.accessAud).toBe(PLACEHOLDER);
    expect(isPlaceholder(prod.accessAud)).toBe(true);
    const r = parseConfig(prod.vars);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.issues).toEqual(["ACCESS_AUD: placeholder value"]);
  });

  it("parses as an Access deployment for the team once the AUD is set", () => {
    const r = parseConfig({ ...prod.vars, ACCESS_AUD: AUD });
    expect(r.ok).toBe(true);
    if (r.ok && r.config.auth.mode === "access") {
      expect(r.config.auth.issuer).toBe(PROD.teamDomain);
      expect(r.config.auth.audience).toBe(AUD);
      expect(r.config.auth.jwksUrl).toBe(`${PROD.teamDomain}/cdn-cgi/access/certs`);
      expect(r.config.triageProvider).toBe("workers-ai");
      expect(r.config.triageModel).toBe(PROD.model);
    }
  });

  it("names every Cloudflare resource with the placessync prefix", () => {
    const p = cfg.env.production as { workflows: { name: string }[]; d1_databases: { database_name: string }[] };
    expect(String(cfg.name)).toMatch(/^placessync/);
    for (const w of p.workflows) expect(w.name).toMatch(/^placessync-/);
    for (const d of p.d1_databases) expect(d.database_name).toMatch(/^placessync/);
    for (const n of [PROD.workerName, PROD.accessAppName, PROD.accessPolicyName, PROD.otpIdpName, PROD.workflowName]) expect(n).toMatch(/^placessync-/);
  });

  it("uses nothing that needs Workers Paid", () => {
    // limits.cpu_ms (and raising subrequests) is Paid only; Free has SQLite-backed Durable Objects only.
    expect(text).not.toMatch(/"limits"\s*:/);
    const migrations = cfg.migrations as Record<string, unknown>[];
    for (const m of migrations) {
      expect(Object.keys(m).filter((k) => k !== "tag")).toEqual(["new_sqlite_classes"]);
    }
    // Free allows 5 Cron Triggers per account; this Worker uses one.
    expect((cfg.triggers as { crons: string[] }).crons).toEqual(["*/2 * * * *"]);
    expect(cfg.env.production.limits).toBeUndefined();
    expect(cfg.env.production.ai).toEqual({ binding: "AI" });
  });
});

describe("setProductionValue", () => {
  it("writes the D1 id and AUD into env.production only, keeping the local D1 id", () => {
    const next = setProductionValue(setProductionValue(text, "database_id", D1), "ACCESS_AUD", AUD);
    const v = readProductionValues(next);
    expect(v.databaseId).toBe(D1);
    expect(v.accessAud).toBe(AUD);
    const top = parseJsonc(next) as { d1_databases: { database_id: string }[] };
    expect(top.d1_databases[0]?.database_id).toBe("00000000-0000-0000-0000-000000000000");
    // Only the two values changed.
    expect(next.replace(D1, PLACEHOLDER).replace(AUD, PLACEHOLDER)).toBe(text);
    // Idempotent.
    expect(setProductionValue(next, "database_id", D1)).toBe(next);
  });

  it("refuses values that are not what Cloudflare issues", () => {
    expect(() => setProductionValue(text, "database_id", "placessync")).toThrow(/not a D1 UUID/);
    expect(() => setProductionValue(text, "ACCESS_AUD", "SET_ME")).toThrow(/AUD/);
  });
});

describe("personas", () => {
  it("are the owner as admin plus plus-addresses of the same inbox, one per role", () => {
    expect(PERSONAS.map((p) => p.role)).toEqual(["facilities_admin", "facilities_staff", "employee"]);
    const [local, domain] = (PERSONAS[0]?.email ?? "").split("@");
    for (const p of PERSONAS.slice(1)) expect(p.email).toMatch(new RegExp(`^${local}\\+[a-z]+@${domain?.replace(".", "\\.")}$`));
    expect(new Set(PERSONAS.map((p) => p.id)).size).toBe(PERSONAS.length);
  });
});
