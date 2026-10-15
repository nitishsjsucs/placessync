// Minimal Cloudflare REST client for prod-setup, prod-doctor and prod-verify. The account
// API token comes from the environment variable CF_API_TOKEN and is only ever placed in the
// Authorization header: it is never printed, logged, written to a file or included in an
// error. wrangler keeps its own OAuth login for everything wrangler can do, and never sees
// the token: wrangler would read CF_API_TOKEN as a deprecated alias of
// CLOUDFLARE_API_TOKEN, so childEnv() in wrangler-cli.ts removes it from every child
// process. This client covers what wrangler cannot (Access, the workers.dev subdomain, the
// account's Cron Triggers, GraphQL analytics). fetch is injectable so tests use fakes.
export const CF_API = "https://api.cloudflare.com/client/v4";

/** The environment variable the account API token comes from. */
export const TOKEN_ENV_VAR = "CF_API_TOKEN";

/**
 * Permissions the token needs, per use. Setup needs the first two; doctor reads with them;
 * the analytics permission lets prod-verify measure CPU time.
 */
export const TOKEN_PERMISSIONS = [
  "Account > Access: Apps and Policies > Edit (Access application and its policy)",
  "Account > Access: Organizations, Identity Providers, and Groups > Edit (One-time PIN login; Read is enough once it exists)",
  "Account > Workers Scripts > Read (workers.dev subdomain, the account's Cron Triggers)",
  "Account > Account Analytics > Read (CPU time in prod-verify)",
] as const;

export function tokenFromEnv(env: NodeJS.ProcessEnv = process.env): string | null {
  return env[TOKEN_ENV_VAR]?.trim() || null;
}

export class CfApiError extends Error {
  override name = "CfApiError";
  readonly status: number;
  readonly codes: number[];
  constructor(method: string, path: string, status: number, errors: { code: number; message: string }[]) {
    // Cloudflare's error messages describe the request, never the credential.
    super(`${method} ${path}: HTTP ${status}${errors.length ? ` (${errors.map((e) => `${e.code} ${e.message}`).join("; ")})` : ""}`);
    this.status = status;
    this.codes = errors.map((e) => e.code);
  }
  /** 403 / code 10000 or 9109: the token lacks a permission for this call. */
  get isPermission(): boolean {
    return this.status === 403 || this.codes.includes(10000) || this.codes.includes(9109);
  }
}

export interface AccessOrganization {
  name: string;
  auth_domain: string;
}
export interface IdentityProvider {
  id: string;
  name: string;
  type: string;
}
export interface AccessRule {
  email?: { email: string };
  [other: string]: unknown;
}
export interface AccessPolicy {
  id: string;
  name: string;
  decision: string;
  include: AccessRule[];
  exclude?: AccessRule[];
  require?: AccessRule[];
}
export interface AccessAppPolicyRef {
  id: string;
  name?: string;
  precedence?: number;
  decision?: string;
  include?: AccessRule[];
  reusable?: boolean;
}
export interface AccessApp {
  id: string;
  name: string;
  aud: string;
  type: string;
  domain?: string;
  destinations?: { type: string; uri?: string }[];
  session_duration?: string;
  allowed_idps?: string[];
  auto_redirect_to_identity?: boolean;
  app_launcher_visible?: boolean;
  policies?: AccessAppPolicyRef[];
}

export class CfApi {
  readonly accountId: string;
  readonly #token: string;
  readonly #fetch: typeof fetch;

  constructor(accountId: string, token: string, fetchImpl: typeof fetch = fetch) {
    this.accountId = accountId;
    this.#token = token;
    this.#fetch = fetchImpl;
  }

  /** Keeps the token out of console.log and JSON.stringify of this object. */
  toJSON(): Record<string, string> {
    return { accountId: this.accountId };
  }
  [Symbol.for("nodejs.util.inspect.custom")](): string {
    return `CfApi { accountId: '${this.accountId}' }`;
  }

  async call<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await this.#fetch(`${CF_API}${path}`, {
      method,
      headers: { authorization: `Bearer ${this.#token}`, "content-type": "application/json" },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    const env = (await res.json().catch(() => null)) as { success?: boolean; errors?: { code: number; message: string }[]; result?: T } | null;
    if (!res.ok || !env?.success) throw new CfApiError(method, path, res.status, env?.errors ?? []);
    return env.result as T;
  }

  private acct(p: string): string {
    return `/accounts/${this.accountId}${p}`;
  }

  organization(): Promise<AccessOrganization> {
    return this.call("GET", this.acct("/access/organizations"));
  }
  identityProviders(): Promise<IdentityProvider[]> {
    return this.call("GET", this.acct("/access/identity_providers"));
  }
  createIdentityProvider(body: unknown): Promise<IdentityProvider> {
    return this.call("POST", this.acct("/access/identity_providers"), body);
  }
  accessPolicies(): Promise<AccessPolicy[]> {
    return this.call("GET", this.acct("/access/policies?per_page=100"));
  }
  createAccessPolicy(body: unknown): Promise<AccessPolicy> {
    return this.call("POST", this.acct("/access/policies"), body);
  }
  updateAccessPolicy(id: string, body: unknown): Promise<AccessPolicy> {
    return this.call("PUT", this.acct(`/access/policies/${id}`), body);
  }
  accessApps(): Promise<AccessApp[]> {
    return this.call("GET", this.acct("/access/apps?per_page=100"));
  }
  createAccessApp(body: unknown): Promise<AccessApp> {
    return this.call("POST", this.acct("/access/apps"), body);
  }
  updateAccessApp(id: string, body: unknown): Promise<AccessApp> {
    return this.call("PUT", this.acct(`/access/apps/${id}`), body);
  }
  /** null when the account has no workers.dev subdomain (error 10007). */
  async workersSubdomain(): Promise<string | null> {
    try {
      return (await this.call<{ subdomain: string }>("GET", this.acct("/workers/subdomain"))).subdomain;
    } catch (e) {
      if (e instanceof CfApiError && e.codes.includes(10007)) return null;
      throw e;
    }
  }
  workerScripts(): Promise<{ id: string }[]> {
    return this.call("GET", this.acct("/workers/scripts"));
  }
  async scriptCrons(script: string): Promise<string[]> {
    const r = await this.call<{ schedules: { cron: string }[] }>("GET", this.acct(`/workers/scripts/${encodeURIComponent(script)}/schedules`));
    return r.schedules.map((s) => s.cron);
  }
  /** GraphQL Analytics API; returns data or throws with the first error message. */
  async graphql<T>(query: string, variables: Record<string, unknown>): Promise<T> {
    const res = await this.#fetch(`${CF_API}/graphql`, {
      method: "POST",
      headers: { authorization: `Bearer ${this.#token}`, "content-type": "application/json" },
      body: JSON.stringify({ query, variables }),
    });
    const body = (await res.json().catch(() => null)) as { data?: T; errors?: { message: string }[] | null } | null;
    if (!res.ok || !body || (body.errors && body.errors.length > 0) || !body.data) {
      throw new Error(`GraphQL: HTTP ${res.status}${body?.errors?.[0] ? ` (${body.errors[0].message})` : ""}`);
    }
    return body.data;
  }
}
