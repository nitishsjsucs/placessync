// Mints dev-mode JWTs for tests with the RS256 key pinned in vitest.config.ts.
import { env } from "cloudflare:workers";
import { signDevToken } from "../../src/worker/auth/dev-tokens.ts";
import { SEED, generateEmployees } from "../../src/shared/synthetic/index.ts";

const employees = generateEmployees(SEED);
const emailById = new Map(employees.map((e) => [e.id, e.email]));

export function emailOf(employeeId: string): string {
  const email = emailById.get(employeeId);
  if (!email) throw new Error(`no synthetic employee ${employeeId}`);
  return email;
}

export interface MintOptions {
  email?: string;
  issuer?: string;
  audience?: string;
  privateJwk?: string;
  nowMs?: number;
  ttlSeconds?: number;
  extraClaims?: Record<string, unknown>;
}

export async function tokenFor(employeeId: string, opts: MintOptions = {}): Promise<string> {
  const { token } = await signDevToken({
    privateJwk: opts.privateJwk ?? env.DEV_ACCESS_PRIVATE_JWK,
    issuer: opts.issuer ?? env.DEV_ACCESS_ISSUER ?? "",
    audience: opts.audience ?? env.DEV_ACCESS_AUD ?? "",
    email: opts.email ?? emailOf(employeeId),
    sub: employeeId,
    nowMs: opts.nowMs ?? Date.now(),
    ttlSeconds: opts.ttlSeconds,
    extraClaims: opts.extraClaims,
  });
  return token;
}

export function authHeaders(token: string): Record<string, string> {
  return { "Cf-Access-Jwt-Assertion": token };
}

export const EMPLOYEE = "emp_001";
export const EMPLOYEE_2 = "emp_002";
export const STAFF = "emp_093";
export const ADMIN = "emp_100";
