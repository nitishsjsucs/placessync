// Request pipeline (SPEC 8): requestId, secureHeaders, config, requireSameOrigin,
// authenticate, requireRole, requireKnownSite.
import type { MiddlewareHandler } from "hono";
import { getCookie } from "hono/cookie";
import type { Role } from "../../shared/roles.ts";
import type { AppEnv } from "../app-env.ts";
import { parseConfig, type ConfigResult } from "../config.ts";
import { errorResponse } from "../http.ts";
import { findActiveEmployeeByEmail } from "../repo/employees.ts";
import { TokenError } from "./access-verifier.ts";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);
const parsedConfigs = new WeakMap<object, ConfigResult>();

export const AUTH_COOKIE = "CF_Authorization";
export const ACCESS_HEADER = "Cf-Access-Jwt-Assertion";

export const configMiddleware: MiddlewareHandler<AppEnv> = async (c, next) => {
  let result = parsedConfigs.get(c.env);
  if (!result) {
    result = parseConfig(c.env as unknown as Record<string, unknown>);
    parsedConfigs.set(c.env, result);
  }
  if (!result.ok) {
    console.error("placessync misconfigured", result.issues);
    return errorResponse(c, 500, "misconfigured", "The server configuration is invalid.");
  }
  if (result.config.authMode === "dev" && !LOCAL_HOSTS.has(new URL(c.req.url).hostname)) {
    return errorResponse(c, 403, "dev_mode_remote_request", "Dev mode only answers requests to localhost.");
  }
  c.set("config", result.config);
  await next();
};

export function isWebSocketUpgrade(req: Request): boolean {
  return req.headers.get("upgrade")?.toLowerCase() === "websocket";
}

/** Non-GET requests and WebSocket upgrades must come from this origin when Origin is sent. */
export const requireSameOrigin: MiddlewareHandler<AppEnv> = async (c, next) => {
  const unsafe = !["GET", "HEAD", "OPTIONS"].includes(c.req.method) || isWebSocketUpgrade(c.req.raw);
  if (unsafe) {
    const origin = c.req.header("origin");
    if (origin && origin !== new URL(c.req.url).origin) {
      return errorResponse(c, 403, "forbidden_origin", "Cross-origin requests are not allowed.");
    }
  }
  await next();
};

/** Dev routes exist only in dev mode; in access mode they are 404 as if never mounted. */
export const devOnly: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (c.get("config").authMode !== "dev") return errorResponse(c, 404, "not_found", "Not found.");
  await next();
};

export const authenticate: MiddlewareHandler<AppEnv> = async (c, next) => {
  const config = c.get("config");
  const deps = c.get("deps");
  const header = c.req.header(ACCESS_HEADER);
  const token = header ?? (config.authMode === "dev" ? getCookie(c, AUTH_COOKIE) : undefined);
  if (!token) return errorResponse(c, 401, "unauthenticated", "Sign in to continue.");
  let verified;
  try {
    verified = await c.get("verifier").verify(token, deps.now());
  } catch (err) {
    if (err instanceof TokenError) return errorResponse(c, 401, "invalid_token", "Your session is invalid or expired.");
    throw err;
  }
  const employee = await findActiveEmployeeByEmail(c.env.DB, verified.email);
  if (!employee) return errorResponse(c, 403, "unknown_user", "This account is not an active employee.");
  c.set("principal", {
    employeeId: employee.id,
    email: employee.email,
    displayName: employee.displayName,
    department: employee.department,
    role: employee.role,
    exp: verified.exp,
  });
  await next();
};

export function requireRole(...roles: Role[]): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    if (!roles.includes(c.get("principal").role)) {
      return errorResponse(c, 403, "forbidden", "Your role cannot use this.");
    }
    await next();
  };
}

/** Routes with :siteId accept only the configured site (SPEC 7.5). */
export const requireKnownSite: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (c.req.param("siteId") !== c.get("config").siteId) {
    return errorResponse(c, 404, "site_not_found", "Unknown site.");
  }
  await next();
};
