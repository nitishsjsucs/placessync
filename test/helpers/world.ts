// HTTP helpers for worker tests: requests go to http://localhost so the dev-mode host
// guard applies exactly as in local dev (SPEC 12).
import { exports } from "cloudflare:workers";
import { authHeaders, tokenFor } from "./tokens.ts";

export const BASE = "http://localhost";

export function call(path: string, init: RequestInit = {}): Promise<Response> {
  return exports.default.fetch(new Request(`${BASE}${path}`, init));
}

export async function json<T = Record<string, unknown>>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

export async function seed(body: { reset?: boolean; history?: boolean } = {}): Promise<Record<string, number>> {
  const res = await call("/api/dev/seed", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ reset: true, history: false, ...body }),
  });
  if (res.status !== 200) throw new Error(`seed failed: ${res.status} ${await res.text()}`);
  return json(res);
}

/** A fetch bound to one employee's token. */
export async function as(employeeId: string) {
  const token = await tokenFor(employeeId);
  const fetcher = (path: string, init: RequestInit = {}) =>
    call(path, { ...init, headers: { ...authHeaders(token), ...(init.headers as Record<string, string> | undefined) } });
  const send = (method: string, path: string, body?: unknown, headers: Record<string, string> = {}) =>
    fetcher(path, {
      method,
      headers: { "content-type": "application/json", ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  return {
    token,
    get: (path: string) => fetcher(path),
    post: (path: string, body?: unknown, headers?: Record<string, string>) => send("POST", path, body, headers),
    patch: (path: string, body?: unknown) => send("PATCH", path, body),
  };
}

import { env } from "cloudflare:workers";
import { addBusinessDays, siteToday } from "../../src/shared/time.ts";
import { ledgerFor } from "../../src/worker/ledger/ledger-for.ts";

export const TZ = "America/Los_Angeles";

/** The hq ledger stub, reached the same way the Worker reaches it. */
export function hqLedger() {
  return ledgerFor(env, { siteId: "hq" }, "hq");
}

/** The n-th business day after today in site-local time (n >= 1). */
export function bizDay(n: number): string {
  return addBusinessDays(siteToday(TZ, Date.now()), n);
}
