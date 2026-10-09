// Error codes shared by the API and the client. Every error body is
// { error: ErrorCode, message: string, issues?: Issue[], ...details } (SPEC 8).
export const ERROR_CODES = [
  "misconfigured",
  "dev_mode_remote_request",
  "forbidden_origin",
  "unsupported_media_type",
  "unauthenticated",
  "invalid_token",
  "unknown_user",
  "forbidden",
  "not_found",
  "site_not_found",
  "resource_not_found",
  "reservation_not_found",
  "request_not_found",
  "validation",
  "idempotency_key_reuse",
  "resource_conflict",
  "employee_conflict",
  "not_owner",
  "already_started",
  "not_confirmed",
  "not_reviewable",
  "invalid_transition",
  "not_cancellable",
  "upgrade_required",
  "unknown_site",
  "internal",
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export interface Issue {
  path: string;
  code: string;
  message: string;
}

export interface ErrorBody {
  error: ErrorCode;
  message: string;
  issues?: Issue[];
  [detail: string]: unknown;
}
