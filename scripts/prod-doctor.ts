// Read-only production doctor: reports exactly what is missing for PlacesSync to run on
// the production account, and how to fix each item. It never creates, changes or deletes
// anything: wrangler list/info commands, `wrangler d1 execute` with one SELECT, Cloudflare
// API GETs (only with an account API token in CF_API_TOKEN), one unauthenticated GET of
// the Worker's /api/health, which Access should redirect to its sign-in page, and, when
// the verification service token is stored in .prod/, GET /api/health and /api/me with it.
//
//   npm run prod:doctor            human-readable report; exit 0 when nothing is missing
//   npm run prod:doctor -- --json  the same checks as JSON
import { parseArgs } from "node:util";
import { CfApi, tokenFromEnv } from "./lib/cf-api.ts";
import { PROD } from "./lib/prod-config.ts";
import { doctorReport, formatReport, gatherProduction } from "./lib/prod-state.ts";

if (import.meta.main) {
  const { values } = parseArgs({ options: { json: { type: "boolean", default: false } } });
  const token = tokenFromEnv();
  const state = await gatherProduction(token ? new CfApi(PROD.accountId, token) : null);
  const checks = doctorReport(state);
  if (values.json) console.log(JSON.stringify(checks, null, 2));
  else {
    console.log(formatReport(checks));
    const missing = checks.filter((c) => c.status === "missing").length;
    const unknown = checks.filter((c) => c.status === "unknown").length;
    console.log(`\n${checks.length - missing - unknown} ok, ${missing} missing, ${unknown} not checked`);
  }
  process.exit(checks.some((c) => c.status !== "ok") ? 1 : 0);
}
