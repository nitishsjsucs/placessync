// Fail-closed config parsing (SPEC 7.4). Every var arrives typed as string; zod narrows
// it. Any problem makes every /api/* route answer 500 misconfigured.
import { z } from "zod";

export type TriageProviderId = "workers-ai" | "openai-compat" | "stub";

export type AuthConfig =
  | { mode: "access"; issuer: string; audience: string; jwksUrl: string }
  | { mode: "dev"; issuer: string; audience: string; jwks: string; privateJwk: string };

export interface Config {
  authMode: "access" | "dev";
  siteId: string;
  auth: AuthConfig;
  triageProvider: TriageProviderId;
  triageModel: string;
  aiGatewayId: string;
  llmBaseUrl: string;
  llmModel: string;
}

export type ConfigResult = { ok: true; config: Config } | { ok: false; issues: string[] };

const notPlaceholder = (v: string) => !v.includes("SET_ME") && !v.includes("REPLACE_WITH");

const nonEmpty = z.string().trim().min(1).refine(notPlaceholder, "placeholder value");

const teamDomain = nonEmpty.refine((v) => {
  try {
    const u = new URL(v);
    return u.protocol === "https:" && u.hostname.endsWith(".cloudflareaccess.com") && (u.pathname === "/" || u.pathname === "");
  } catch {
    return false;
  }
}, "must be https://<team>.cloudflareaccess.com");

const rsaJwks = nonEmpty.refine((v) => {
  try {
    const parsed = JSON.parse(v) as { keys?: { kty?: string; alg?: string; d?: string }[] };
    return (
      Array.isArray(parsed.keys) &&
      parsed.keys.some((k) => k.kty === "RSA" && (k.alg === undefined || k.alg === "RS256") && k.d === undefined)
    );
  } catch {
    return false;
  }
}, "must be a JWKS with at least one RS256 public key");

const rsaPrivateJwk = nonEmpty.refine((v) => {
  try {
    const k = JSON.parse(v) as { kty?: string; d?: string };
    return k.kty === "RSA" && typeof k.d === "string";
  } catch {
    return false;
  }
}, "must be an RSA private JWK");

const base = z.object({
  SITE_ID: z.string().regex(/^[a-z0-9][a-z0-9-]{0,31}$/, "must be a lowercase slug"),
  TRIAGE_PROVIDER: z.enum(["workers-ai", "openai-compat", "stub"]),
  TRIAGE_MODEL: z.string().optional(),
  AI_GATEWAY_ID: z.string().optional(),
  LLM_BASE_URL: z.string().optional(),
  LLM_MODEL: z.string().optional(),
});

const accessSchema = base.extend({
  AUTH_MODE: z.literal("access"),
  ACCESS_TEAM_DOMAIN: teamDomain,
  ACCESS_AUD: nonEmpty,
});

const devSchema = base.extend({
  AUTH_MODE: z.literal("dev"),
  DEV_ACCESS_ISSUER: nonEmpty,
  DEV_ACCESS_AUD: nonEmpty,
  DEV_ACCESS_JWKS: rsaJwks,
  DEV_ACCESS_PRIVATE_JWK: rsaPrivateJwk,
});

const schema = z.discriminatedUnion("AUTH_MODE", [accessSchema, devSchema]);

export const DEFAULT_WORKERS_AI_MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";

export function parseConfig(env: Record<string, unknown>): ConfigResult {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    return { ok: false, issues: parsed.error.issues.map((i) => `${i.path.join(".") || "env"}: ${i.message}`) };
  }
  const e = parsed.data;
  const auth: AuthConfig =
    e.AUTH_MODE === "access"
      ? {
          mode: "access",
          issuer: e.ACCESS_TEAM_DOMAIN.replace(/\/$/, ""),
          audience: e.ACCESS_AUD,
          jwksUrl: `${e.ACCESS_TEAM_DOMAIN.replace(/\/$/, "")}/cdn-cgi/access/certs`,
        }
      : {
          mode: "dev",
          issuer: e.DEV_ACCESS_ISSUER,
          audience: e.DEV_ACCESS_AUD,
          jwks: e.DEV_ACCESS_JWKS,
          privateJwk: e.DEV_ACCESS_PRIVATE_JWK,
        };
  return {
    ok: true,
    config: {
      authMode: e.AUTH_MODE,
      siteId: e.SITE_ID,
      auth,
      triageProvider: e.TRIAGE_PROVIDER,
      triageModel: e.TRIAGE_MODEL || DEFAULT_WORKERS_AI_MODEL,
      aiGatewayId: e.AI_GATEWAY_ID ?? "",
      llmBaseUrl: e.LLM_BASE_URL || "http://127.0.0.1:8130/v1",
      llmModel: e.LLM_MODEL || "qwen3-1.7b",
    },
  };
}
