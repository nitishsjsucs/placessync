// The Hono app (SPEC 8). createApp takes its dependencies so tests can inject a
// verifier factory, a clock and id generation without module singletons (SPEC 9.2).
import { Hono } from "hono";
import { requestId } from "hono/request-id";
import { secureHeaders } from "hono/secure-headers";
import type { AppDeps, AppEnv } from "./app-env.ts";
import { type AccessVerifier, makeVerifierFactory, verifierKey } from "./auth/access-verifier.ts";
import { authenticate, configMiddleware, devOnly, requireKnownSite, requireSameOrigin } from "./auth/middleware.ts";
import { ApiError, errorResponse } from "./http.ts";
import { newId } from "./ids.ts";
import { adminRoutes } from "./routes/admin.ts";
import { availabilityRoutes } from "./routes/availability.ts";
import { calendarRoutes } from "./routes/calendar.ts";
import { devRoutes } from "./routes/dev.ts";
import { healthRoutes } from "./routes/health.ts";
import { liveRoutes } from "./routes/live.ts";
import { meRoutes } from "./routes/me.ts";
import { requestRoutes } from "./routes/requests.ts";
import { reservationRoutes } from "./routes/reservations.ts";
import { resourceRoutes } from "./routes/resources.ts";
import { staffRoutes } from "./routes/staff.ts";

export type { AppDeps, AppEnv } from "./app-env.ts";

export const defaultDeps: AppDeps = {
  verifierFactory: makeVerifierFactory(),
  now: () => Date.now(),
  newId: (prefix) => newId(prefix),
  triageWorkflow: (env) => env.TRIAGE_WORKFLOW,
};

/** Paths reachable without a token. Dev paths are additionally dev-mode only. */
const PUBLIC_PATHS = new Set(["/api/health", "/api/dev/users", "/api/dev/login", "/api/dev/logout", "/api/dev/seed"]);

export function createApp(deps: AppDeps): Hono<AppEnv> {
  // One verifier per auth config, memoized inside this app instance, so a test app
  // never shares a cached remote key set with another app.
  const verifiers = new Map<string, AccessVerifier>();

  const app = new Hono<AppEnv>();
  app.use("/api/*", requestId());
  app.use("/api/*", secureHeaders());
  app.use("/api/*", async (c, next) => {
    c.set("deps", deps);
    await next();
  });
  app.use("/api/*", configMiddleware);
  app.use("/api/*", requireSameOrigin);
  app.use("/api/dev/*", devOnly);
  app.use("/api/*", async (c, next) => {
    const auth = c.get("config").auth;
    const key = verifierKey(auth);
    let verifier = verifiers.get(key);
    if (!verifier) {
      verifier = deps.verifierFactory(auth);
      verifiers.set(key, verifier);
    }
    c.set("verifier", verifier);
    if (PUBLIC_PATHS.has(c.req.path)) return next();
    return authenticate(c, next);
  });

  app.use("/api/sites/:siteId/*", requireKnownSite);

  app.route("/", healthRoutes);
  app.route("/", meRoutes);
  app.route("/", devRoutes);
  app.route("/", resourceRoutes);
  app.route("/", availabilityRoutes);
  app.route("/", calendarRoutes);
  app.route("/", reservationRoutes);
  app.route("/", liveRoutes);
  app.route("/", requestRoutes);
  app.route("/", staffRoutes);
  app.route("/", adminRoutes);

  app.notFound((c) => {
    if (c.req.path.startsWith("/api/")) return errorResponse(c, 404, "not_found", "Not found.");
    return c.env.ASSETS.fetch(c.req.raw);
  });

  app.onError((err, c) => {
    if (err instanceof ApiError) return errorResponse(c, err.status, err.code, err.message, err.details);
    console.error("unhandled error", err);
    return errorResponse(c, 500, "internal", "Something went wrong.");
  });

  return app;
}
