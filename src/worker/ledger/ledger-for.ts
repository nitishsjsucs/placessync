// The ONLY call site of SITE_LEDGER.getByName (SPEC 7.5). Durable Object names never
// come straight from a request: the site id must equal the configured SITE_ID.
// test/node/ledger-for-guard.test.ts fails if getByName appears anywhere else.
import type { Config } from "../config.ts";
import { ApiError } from "../http.ts";

export function ledgerFor(env: Env, config: Pick<Config, "siteId">, siteId: string) {
  if (siteId !== config.siteId) throw new ApiError(404, "unknown_site", "Unknown site.");
  return env.SITE_LEDGER.getByName(siteId);
}
