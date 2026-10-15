// What the Access setup should look like, and how the account differs from it. Pure
// functions over API shapes, so prod-setup (which converges) and prod-doctor (which only
// reports) agree, and tests need no network.
//
// - Login: only the account's existing One-time PIN login (PROD.otpIdpId). Setup never
//   creates or changes a login method; it stops if that one is missing.
// - Policy 1, Allow: exactly the owner and persona emails.
// - Policy 2, Service Auth: exactly the verification service token, for prod-verify.
// - Application: self-hosted, for the workers.dev hostname only, with those two policies.
//
// The application is hostname-based (a self-hosted app for the workers.dev hostname), not
// a Worker destination: Cloudflare's docs say Worker-level Access policies fail WebSocket
// upgrades with 403, and the live availability channel is a WebSocket
// (https://developers.cloudflare.com/workers/configuration/cloudflare-access/).
import type { AccessApp, AccessPolicy, IdentityProvider, ServiceToken } from "./cf-api.ts";
import { PERSONAS, PROD, PROD_HOST } from "./prod-config.ts";

export interface DesiredAccess {
  appName: string;
  host: string;
  sessionDuration: string;
  otpIdpId: string;
  policyName: string;
  emails: string[];
  serviceTokenName: string;
  servicePolicyName: string;
}

export const DESIRED: DesiredAccess = {
  appName: PROD.accessAppName,
  host: PROD_HOST,
  sessionDuration: PROD.sessionDuration,
  otpIdpId: PROD.otpIdpId,
  policyName: PROD.accessPolicyName,
  emails: PERSONAS.map((p) => p.email),
  serviceTokenName: PROD.serviceTokenName,
  servicePolicyName: PROD.servicePolicyName,
};

const norm = (emails: readonly string[]) => [...new Set(emails.map((e) => e.trim().toLowerCase()))].sort();

/** The configured One-time PIN login, or why it cannot be used. */
export function checkOtp(idps: readonly IdentityProvider[], d: DesiredAccess = DESIRED): { ok: true; idp: IdentityProvider } | { ok: false; reason: string } {
  const idp = idps.find((i) => i.id === d.otpIdpId);
  if (!idp) return { ok: false, reason: `the account has no login method with id ${d.otpIdpId}` };
  if (idp.type !== "onetimepin") return { ok: false, reason: `login method ${d.otpIdpId} is ${idp.type}, not One-time PIN` };
  return { ok: true, idp };
}

// ---------- Allow policy (people) ----------

export function policyBody(d: DesiredAccess = DESIRED): Record<string, unknown> {
  return { name: d.policyName, decision: "allow", include: norm(d.emails).map((email) => ({ email: { email } })) };
}

export function findPolicy(policies: readonly AccessPolicy[], d: DesiredAccess = DESIRED): AccessPolicy | null {
  return policies.find((p) => p.name === d.policyName) ?? null;
}

/** Ways an existing Allow policy differs from the desired one; empty when it matches. */
export function policyDrift(p: AccessPolicy, d: DesiredAccess = DESIRED): string[] {
  const out: string[] = [];
  if (p.decision !== "allow") out.push(`decision is ${p.decision}, want allow`);
  const emails = p.include.map((r) => r.email?.email).filter((e): e is string => typeof e === "string");
  if (emails.length !== p.include.length) out.push("include has rules other than single emails");
  const have = norm(emails);
  const want = norm(d.emails);
  if (have.join(",") !== want.join(",")) out.push(`emails are [${have.join(", ")}], want [${want.join(", ")}]`);
  if ((p.exclude?.length ?? 0) > 0 || (p.require?.length ?? 0) > 0) out.push("has exclude or require rules");
  return out;
}

// ---------- service token and Service Auth policy ----------

export function findServiceToken(tokens: readonly ServiceToken[], d: DesiredAccess = DESIRED): ServiceToken | null {
  const hits = tokens.filter((t) => t.name === d.serviceTokenName);
  if (hits.length > 1) throw new Error(`${hits.length} service tokens are named ${d.serviceTokenName}; delete the extra ones in Zero Trust and rerun`);
  return hits[0] ?? null;
}

export function servicePolicyBody(tokenId: string, d: DesiredAccess = DESIRED): Record<string, unknown> {
  return { name: d.servicePolicyName, decision: "non_identity", include: [{ service_token: { token_id: tokenId } }] };
}

export function findServicePolicy(policies: readonly AccessPolicy[], d: DesiredAccess = DESIRED): AccessPolicy | null {
  return policies.find((p) => p.name === d.servicePolicyName) ?? null;
}

/** Ways an existing Service Auth policy differs; empty when it admits exactly the token. */
export function servicePolicyDrift(p: AccessPolicy, tokenId: string): string[] {
  const out: string[] = [];
  if (p.decision !== "non_identity") out.push(`decision is ${p.decision}, want non_identity (Service Auth)`);
  const ids = p.include.map((r) => r.service_token?.token_id);
  if (ids.length !== 1 || ids[0] !== tokenId) out.push("include is not exactly the verification service token");
  if ((p.exclude?.length ?? 0) > 0 || (p.require?.length ?? 0) > 0) out.push("has exclude or require rules");
  return out;
}

/** Days until the token expires, or null when the API gives no expiry. */
export function daysToExpiry(t: ServiceToken, now: Date): number | null {
  if (!t.expires_at) return null;
  const ms = Date.parse(t.expires_at) - now.getTime();
  return Number.isFinite(ms) ? Math.floor(ms / 86_400_000) : null;
}

// ---------- application ----------

/** Every hostname the app protects: its domain plus its public destinations, deduplicated. */
const appHosts = (a: AccessApp): string[] => [
  ...new Set([a.domain ?? "", ...(a.destinations ?? []).map((x) => x.uri ?? "")].filter(Boolean).map((h) => h.replace(/\/$/, ""))),
];

/** The one app that protects the host; throws if more than one does (a human must decide). */
export function findApp(apps: readonly AccessApp[], d: DesiredAccess = DESIRED): AccessApp | null {
  const hits = apps.filter((a) => appHosts(a).includes(d.host));
  if (hits.length > 1) throw new Error(`${hits.length} Access applications protect ${d.host} (${hits.map((a) => a.name).join(", ")}); keep one and rerun`);
  return hits[0] ?? null;
}

export function appBody(policyId: string, servicePolicyId: string, d: DesiredAccess = DESIRED): Record<string, unknown> {
  return {
    name: d.appName,
    type: "self_hosted",
    domain: d.host,
    destinations: [{ type: "public", uri: d.host }],
    session_duration: d.sessionDuration,
    allowed_idps: [d.otpIdpId],
    auto_redirect_to_identity: true,
    app_launcher_visible: false,
    policies: [
      { id: policyId, precedence: 1 },
      { id: servicePolicyId, precedence: 2 },
    ],
  };
}

/** Ways an existing app differs from the desired one; empty when it matches. */
export function appDrift(a: AccessApp, policyId: string, servicePolicyId: string, d: DesiredAccess = DESIRED): string[] {
  const out: string[] = [];
  if (a.type !== "self_hosted") out.push(`type is ${a.type}, want self_hosted`);
  if (a.name !== d.appName) out.push(`name is ${a.name}, want ${d.appName}`);
  const hosts = appHosts(a);
  if (hosts.length !== 1 || hosts[0] !== d.host) out.push(`protects [${hosts.join(", ")}], want only ${d.host}`);
  if (a.session_duration !== d.sessionDuration) out.push(`session_duration is ${a.session_duration ?? "unset"}, want ${d.sessionDuration}`);
  if ((a.allowed_idps ?? []).join(",") !== d.otpIdpId) out.push(`allowed identity providers are not exactly the One-time PIN login ${d.otpIdpId}`);
  if (a.auto_redirect_to_identity !== true) out.push("auto_redirect_to_identity is not true");
  const ids = [...(a.policies ?? [])].sort((x, y) => (x.precedence ?? 0) - (y.precedence ?? 0)).map((p) => p.id);
  if (ids.join(",") !== [policyId, servicePolicyId].join(",")) out.push(`policies are [${ids.join(", ")}], want ${d.policyName} then ${d.servicePolicyName}`);
  return out;
}

// ---------- the plan ----------

export type AccessAction =
  | { kind: "create-policy" }
  | { kind: "update-policy"; drift: string[] }
  | { kind: "create-service-token" }
  | { kind: "rotate-service-token"; why: string }
  | { kind: "create-service-policy" }
  | { kind: "update-service-policy"; drift: string[] }
  | { kind: "create-app" }
  | { kind: "update-app"; drift: string[] };

export interface AccessState {
  idps: readonly IdentityProvider[];
  policies: readonly AccessPolicy[];
  apps: readonly AccessApp[];
  serviceTokens: readonly ServiceToken[];
  /** The Client ID stored on this Mac with its secret, or null when there is none. */
  localClientId: string | null;
}

/**
 * The changes that would make the account match; empty when Access is already right.
 * Throws when the One-time PIN login is unusable: setup never creates a login method.
 */
export function planAccess(s: AccessState, d: DesiredAccess = DESIRED): AccessAction[] {
  const otp = checkOtp(s.idps, d);
  if (!otp.ok) throw new Error(otp.reason);
  const actions: AccessAction[] = [];

  const policy = findPolicy(s.policies, d);
  if (!policy) actions.push({ kind: "create-policy" });
  else {
    const drift = policyDrift(policy, d);
    if (drift.length) actions.push({ kind: "update-policy", drift });
  }

  const token = findServiceToken(s.serviceTokens, d);
  if (!token) actions.push({ kind: "create-service-token" });
  else if (s.localClientId !== token.client_id) {
    // The secret was shown once; without it here prod-verify cannot sign in, so issue a new one.
    actions.push({ kind: "rotate-service-token", why: s.localClientId ? "the stored Client ID belongs to another token" : "its secret is not stored on this Mac" });
  }

  const servicePolicy = findServicePolicy(s.policies, d);
  if (!servicePolicy) actions.push({ kind: "create-service-policy" });
  else if (!token) actions.push({ kind: "update-service-policy", drift: ["the service token is being created"] });
  else {
    const drift = servicePolicyDrift(servicePolicy, token.id);
    if (drift.length) actions.push({ kind: "update-service-policy", drift });
  }

  const app = findApp(s.apps, d);
  if (!app) actions.push({ kind: "create-app" });
  else if (policy && servicePolicy) {
    const drift = appDrift(app, policy.id, servicePolicy.id, d);
    if (drift.length) actions.push({ kind: "update-app", drift });
  } else {
    actions.push({ kind: "update-app", drift: ["a policy is being created"] });
  }
  return actions;
}
