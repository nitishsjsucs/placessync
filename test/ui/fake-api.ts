// A fetch stub for page tests: routes "METHOD /path" (query string ignored unless the
// key includes one) to JSON responses or handlers, and records every call.
import { vi } from "vitest";

export type Handler = unknown | ((call: { url: string; method: string; body: unknown; headers: Record<string, string> }) => unknown);
export interface FakeResponse {
  __status: number;
  body: unknown;
}

export function respond(status: number, body: unknown): FakeResponse {
  return { __status: status, body };
}

export interface FakeApi {
  calls: { method: string; url: string; body: unknown; headers: Record<string, string> }[];
  set(key: string, handler: Handler): void;
}

export function installFakeApi(handlers: Record<string, Handler>): FakeApi {
  const table = new Map(Object.entries(handlers));
  const calls: FakeApi["calls"] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string, init: RequestInit = {}) => {
      const method = (init.method ?? "GET").toUpperCase();
      const url = String(input);
      const path = url.split("?")[0];
      const headers = Object.fromEntries(Object.entries((init.headers ?? {}) as Record<string, string>).map(([k, v]) => [k.toLowerCase(), v]));
      const body = typeof init.body === "string" ? (JSON.parse(init.body) as unknown) : undefined;
      calls.push({ method, url, body, headers });
      const handler = table.get(`${method} ${url}`) ?? table.get(`${method} ${path}`);
      if (handler === undefined) return Response.json({ error: "not_found", message: `no fake for ${method} ${url}` }, { status: 404 });
      const out = typeof handler === "function" ? await (handler as (c: unknown) => unknown)({ url, method, body, headers }) : handler;
      if (out && typeof out === "object" && "__status" in out) {
        const r = out as FakeResponse;
        return Response.json(r.body, { status: r.__status });
      }
      return Response.json(out);
    }),
  );
  return { calls, set: (key, handler) => table.set(key, handler) };
}

export const HEALTH = {
  ok: true,
  authMode: "dev",
  triage: "ready",
  siteId: "hq",
  seeded: true,
  siteToday: "2026-10-08",
  siteRules: { timezone: "America/Los_Angeles", openMin: 420, closeMin: 1140, horizonDays: 14 },
};

export function me(id: string, role: "employee" | "facilities_staff" | "facilities_admin", displayName = "Test Person") {
  return { employee: { id, email: `${id}@placessync.test`, displayName, department: "Engineering", role } };
}
