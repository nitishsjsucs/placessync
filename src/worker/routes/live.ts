// WebSocket upgrade (SPEC 8). The Worker authenticates, then builds a fresh Request for
// the ledger so client-sent actor headers never pass through.
import { Hono } from "hono";
import type { AppEnv } from "../app-env.ts";
import { isWebSocketUpgrade } from "../auth/middleware.ts";
import { errorResponse } from "../http.ts";
import { ledgerFor } from "../ledger/ledger-for.ts";
import { ACTOR_HEADER, type LiveActor } from "../ledger/live.ts";

export const liveRoutes = new Hono<AppEnv>().get("/api/sites/:siteId/live", async (c) => {
  if (!isWebSocketUpgrade(c.req.raw)) return errorResponse(c, 426, "upgrade_required", "Connect with a WebSocket.");
  const p = c.get("principal");
  const actor: LiveActor = { employeeId: p.employeeId, role: p.role, exp: p.exp };
  const config = c.get("config");
  const forward = new Request("https://ledger.internal/live", {
    headers: { upgrade: "websocket", [ACTOR_HEADER]: JSON.stringify(actor) },
  });
  const upstream = await ledgerFor(c.env, config, config.siteId).fetch(forward);
  if (upstream.status !== 101 || !upstream.webSocket) return upstream;
  // A fresh Response with mutable headers, so the request-id and security-header
  // middleware can still annotate the 101.
  return new Response(null, { status: 101, webSocket: upstream.webSocket });
});
