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
