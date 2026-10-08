// HTTP helpers shared by the routes: typed API errors and zod validation that maps
// failures to 422 { error: "validation", issues } (SPEC 8).
import { zValidator } from "@hono/zod-validator";
import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { z } from "zod";
import type { ErrorCode, Issue } from "../shared/errors.ts";

export class ApiError extends Error {
  readonly status: ContentfulStatusCode;
  readonly code: ErrorCode;
  readonly details: Record<string, unknown>;

  constructor(status: ContentfulStatusCode, code: ErrorCode, message: string, details: Record<string, unknown> = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export function errorResponse(c: Context, status: ContentfulStatusCode, code: ErrorCode, message: string, details: Record<string, unknown> = {}) {
  return c.json({ error: code, message, ...details }, status);
}

export function zodIssues(error: { issues: readonly { path: readonly PropertyKey[]; code: string; message: string }[] }): Issue[] {
  return error.issues.map((i) => ({ path: i.path.map(String).join("."), code: i.code, message: i.message }));
}

/** JSON body validator (@hono/zod-validator). Schema failures give 422 validation. */
export function jsonBody<S extends z.ZodType>(schema: S) {
  return zValidator("json", schema, (result, c) => {
    if (!result.success) {
      return c.json({ error: "validation" as const, message: "The request body is invalid.", issues: zodIssues(result.error) }, 422);
    }
  });
}

/** Query string validator with the same 422 mapping. */
export function queryParams<S extends z.ZodType>(schema: S) {
  return zValidator("query", schema, (result, c) => {
    if (!result.success) {
      return c.json({ error: "validation" as const, message: "The query string is invalid.", issues: zodIssues(result.error) }, 422);
    }
  });
}

/** Reads a JSON body leniently: an empty body becomes {}. */
export async function readJson(req: Request): Promise<unknown> {
  const text = await req.text();
  if (text.trim() === "") return {};
  return JSON.parse(text);
}
