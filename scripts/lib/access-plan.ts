// What the Access setup should look like, and how the account differs from it. Pure
// functions over API shapes, so prod-setup (which converges) and prod-doctor (which only
// reports) agree, and tests need no network.
//
// The application is hostname-based (a self-hosted app for the workers.dev hostname), not
// a Worker destination: Cloudflare's docs say Worker-level Access policies fail WebSocket
// upgrades with 403, and the live availability channel is a WebSocket
// (https://developers.cloudflare.com/workers/configuration/cloudflare-access/).
import type { AccessApp, AccessPolicy, IdentityProvider } from "./cf-api.ts";
import { PERSONAS, PROD, PROD_HOST } from "./prod-config.ts";

export interface DesiredAccess {
  appName: string;
  host: string;
  sessionDuration: string;
  policyName: string;
  emails: string[];
}

export const DESIRED: DesiredAccess = {
  appName: PROD.accessAppName,
  host: PROD_HOST,
  sessionDuration: PROD.sessionDuration,
  policyName: PROD.accessPolicyName,
  emails: PERSONAS.map((p) => p.email),
};

const norm = (emails: readonly string[]) => [...new Set(emails.map((e) => e.trim().toLowerCase()))].sort();

/** The account's One-time PIN login, if it has one (Access allows one per account). */
export function findOtp(idps: readonly IdentityProvider[]): IdentityProvider | null {
  return idps.find((i) => i.type === "onetimepin") ?? null;
}

export function otpBody(name: string = PROD.otpIdpName): Record<string, unknown> {
  return { name, type: "onetimepin", config: {} };
}

export function policyBody(d: DesiredAccess = DESIRED): Record<string, unknown> {
  return { name: d.policyName, decision: "allow", include: norm(d.emails).map((email) => ({ email: { email } })) };
}

export function findPolicy(policies: readonly AccessPolicy[], d: DesiredAccess = DESIRED): AccessPolicy | null {
  return policies.find((p) => p.name === d.policyName) ?? null;
}

/** Ways an existing policy differs from the desired one; empty when it matches. */
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

export function appBody(otpId: string, policyId: string, d: DesiredAccess = DESIRED): Record<string, unknown> {
  return {
    name: d.appName,
    type: "self_hosted",
    domain: d.host,
    destinations: [{ type: "public", uri: d.host }],
    session_duration: d.sessionDuration,
    allowed_idps: [otpId],
    auto_redirect_to_identity: true,
    app_launcher_visible: false,
    policies: [{ id: policyId, precedence: 1 }],
  };
}

/** Ways an existing app differs from the desired one; empty when it matches. */
export function appDrift(a: AccessApp, otpId: string, policyId: string, d: DesiredAccess = DESIRED): string[] {
  const out: string[] = [];
  if (a.type !== "self_hosted") out.push(`type is ${a.type}, want self_hosted`);
  if (a.name !== d.appName) out.push(`name is ${a.name}, want ${d.appName}`);
  const hosts = appHosts(a);
  if (hosts.length !== 1 || hosts[0] !== d.host) out.push(`protects [${hosts.join(", ")}], want only ${d.host}`);
  if (a.session_duration !== d.sessionDuration) out.push(`session_duration is ${a.session_duration ?? "unset"}, want ${d.sessionDuration}`);
  if ((a.allowed_idps ?? []).join(",") !== otpId) out.push("allowed identity providers are not exactly the One-time PIN login");
  if (a.auto_redirect_to_identity !== true) out.push("auto_redirect_to_identity is not true");
  const ids = (a.policies ?? []).map((p) => p.id);
  if (ids.length !== 1 || ids[0] !== policyId) out.push(`policies are [${ids.join(", ")}], want only ${d.policyName}`);
  return out;
}

export type AccessAction =
  | { kind: "create-otp" }
  | { kind: "create-policy" }
  | { kind: "update-policy"; drift: string[] }
  | { kind: "create-app" }
  | { kind: "update-app"; drift: string[] };

/** The changes that would make the account match; empty when Access is already right. */
export function planAccess(state: { idps: readonly IdentityProvider[]; policies: readonly AccessPolicy[]; apps: readonly AccessApp[] }, d: DesiredAccess = DESIRED): AccessAction[] {
  const actions: AccessAction[] = [];
  const otp = findOtp(state.idps);
  if (!otp) actions.push({ kind: "create-otp" });
  const policy = findPolicy(state.policies, d);
  if (!policy) actions.push({ kind: "create-policy" });
  else {
    const drift = policyDrift(policy, d);
    if (drift.length) actions.push({ kind: "update-policy", drift });
  }
  const app = findApp(state.apps, d);
  if (!app) actions.push({ kind: "create-app" });
  else if (otp && policy) {
    const drift = appDrift(app, otp.id, policy.id, d);
    if (drift.length) actions.push({ kind: "update-app", drift });
  } else {
    actions.push({ kind: "update-app", drift: ["login method or policy is being created"] });
  }
  return actions;
}
