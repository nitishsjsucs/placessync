// Typed fetch for the SPA. Responses are parsed with the shared zod schemas, errors
// become ApiClientError with the server's { error, message, issues } body.
import type { z } from "zod";
import type { ErrorBody, Issue } from "../../shared/errors.ts";

export class ApiClientError extends Error {
  readonly status: number;
  readonly body: ErrorBody;
  constructor(status: number, body: ErrorBody) {
    super(body.message || `HTTP ${status}`);
    this.status = status;
    this.body = body;
  }

  get code(): string {
    return this.body.error;
  }

  /** Field errors keyed by path, for forms. */
  fieldErrors(): Record<string, string> {
    const out: Record<string, string> = {};
    for (const i of (this.body.issues ?? []) as Issue[]) if (!out[i.path]) out[i.path] = i.message;
    return out;
  }
}

// A 401 from any data route means the sign-in expired mid-session (the 8 h dev token,
// or an Access session). SessionProvider listens and re-checks /api/me, so the app can
// send the person back to sign in. The session routes themselves never notify, which
// would loop.
type UnauthorizedListener = () => void;
const unauthorizedListeners = new Set<UnauthorizedListener>();

export function onUnauthorized(listener: UnauthorizedListener): () => void {
  unauthorizedListeners.add(listener);
  return () => {
    unauthorizedListeners.delete(listener);
  };
}

function isSessionPath(path: string): boolean {
  const p = path.split("?")[0] ?? path;
  return p === "/api/me" || p === "/api/health" || p.startsWith("/api/dev/");
}

async function request<S extends z.ZodType>(method: string, path: string, schema: S | null, body?: unknown, headers: Record<string, string> = {}): Promise<z.output<S>> {
  const res = await fetch(path, {
    method,
    credentials: "same-origin",
    headers: { accept: "application/json", ...(body !== undefined ? { "content-type": "application/json" } : {}), ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  if (!res.ok) {
    const err = (data && typeof data === "object" ? data : { error: "internal", message: `HTTP ${res.status}` }) as ErrorBody;
    if (res.status === 401 && (err.error === "unauthenticated" || err.error === "invalid_token") && !isSessionPath(path)) {
      for (const listener of [...unauthorizedListeners]) listener();
    }
    throw new ApiClientError(res.status, err);
  }
  return (schema ? schema.parse(data) : data) as z.output<S>;
}

export const api = {
  get: <S extends z.ZodType>(path: string, schema: S) => request("GET", path, schema),
  post: <S extends z.ZodType>(path: string, body: unknown, schema: S, headers?: Record<string, string>) => request("POST", path, schema, body, headers),
  postRaw: (path: string, body?: unknown) => request("POST", path, null, body),
  patch: <S extends z.ZodType>(path: string, body: unknown, schema: S) => request("PATCH", path, schema, body),
};

export function qs(params: Record<string, string | number | undefined | null | false>): string {
  const entries = Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== false && v !== "");
  if (entries.length === 0) return "";
  return `?${new URLSearchParams(entries.map(([k, v]) => [k, String(v)])).toString()}`;
}

/** A fresh Idempotency-Key per booking attempt (8 to 64 characters). */
export function idempotencyKey(): string {
  return `web-${crypto.randomUUID()}`;
}
