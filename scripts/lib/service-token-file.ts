// The verification service token's credentials on this Mac. Cloudflare returns the Client
// Secret once, when the token is created or rotated, so prod-setup writes it here and
// prod-verify reads it. The folder is gitignored and created 0700, the file 0600. Nothing
// prints the secret: describe() names the file and the Client ID only.
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { ROOT } from "./meta.ts";
import { isServiceClientId } from "./prod-config.ts";

export const SERVICE_TOKEN_FILE = path.join(ROOT, ".prod", "verify-service-token.json");

export interface ServiceTokenCredentials {
  /** The service token's id in the Access API (not a secret). */
  tokenId: string;
  clientId: string;
  clientSecret: string;
  writtenAt: string;
}

/** Credentials from PLACESSYNC_VERIFY_CLIENT_ID and PLACESSYNC_VERIFY_CLIENT_SECRET, if both are set. */
export function credentialsFromEnv(env: NodeJS.ProcessEnv = process.env): Pick<ServiceTokenCredentials, "clientId" | "clientSecret"> | null {
  const clientId = env.PLACESSYNC_VERIFY_CLIENT_ID?.trim();
  const clientSecret = env.PLACESSYNC_VERIFY_CLIENT_SECRET?.trim();
  return clientId && clientSecret ? { clientId, clientSecret } : null;
}

/** The stored credentials, or null when the file is missing or malformed. */
export function readServiceToken(file: string = SERVICE_TOKEN_FILE): ServiceTokenCredentials | null {
  if (!existsSync(file)) return null;
  try {
    const v = JSON.parse(readFileSync(file, "utf8")) as Partial<ServiceTokenCredentials>;
    if (typeof v.tokenId !== "string" || typeof v.clientId !== "string" || !isServiceClientId(v.clientId) || typeof v.clientSecret !== "string" || v.clientSecret.length === 0) return null;
    return { tokenId: v.tokenId, clientId: v.clientId, clientSecret: v.clientSecret, writtenAt: String(v.writtenAt ?? "") };
  } catch {
    return null;
  }
}

export function writeServiceToken(creds: Omit<ServiceTokenCredentials, "writtenAt">, file: string = SERVICE_TOKEN_FILE, now: Date = new Date()): void {
  if (!isServiceClientId(creds.clientId) || !creds.clientSecret) throw new Error("refusing to store service token credentials that do not look like Access's");
  mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  chmodSync(path.dirname(file), 0o700);
  writeFileSync(file, `${JSON.stringify({ ...creds, writtenAt: now.toISOString() }, null, 2)}\n`, { mode: 0o600 });
  chmodSync(file, 0o600);
}

/** Headers Access reads a service token from (cloudflare-one/identity/service-tokens). */
export function serviceTokenHeaders(c: Pick<ServiceTokenCredentials, "clientId" | "clientSecret">): Record<string, string> {
  return { "CF-Access-Client-Id": c.clientId, "CF-Access-Client-Secret": c.clientSecret };
}

export function describeCredentials(c: Pick<ServiceTokenCredentials, "clientId">, file: string = SERVICE_TOKEN_FILE): string {
  return `Client ID ${c.clientId} (secret in ${path.relative(ROOT, file)}, not printed)`;
}
