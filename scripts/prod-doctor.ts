// Read-only production doctor: reports exactly what is missing for PlacesSync to run on
// the production account, and how to fix each item. It never creates, changes or deletes
// anything: wrangler list/info commands, `wrangler d1 execute` with one SELECT, Cloudflare
// API GETs (only with an account API token in the environment) and one unauthenticated
// GET of the Worker's /api/health, which Access should redirect to its sign-in page.
//
//   npm run prod:doctor            human-readable report; exit 0 when nothing is missing
//   npm run prod:doctor -- --json  the same checks as JSON
import { parseArgs } from "node:util";
import { CfApi, tokenFromEnv } from "./lib/cf-api.ts";
import { PROD, readProductionValues, readWranglerConfig } from "./lib/prod-config.ts";
import { doctorReport, formatReport, gatherState } from "./lib/prod-state.ts";
import { wrangler } from "./lib/wrangler-cli.ts";

if (import.meta.main) {
  const { values } = parseArgs({ options: { json: { type: "boolean", default: false } } });
  const token = tokenFromEnv();
  const state = await gatherState({
    wrangler,
    api: token ? new CfApi(PROD.accountId, token) : null,
    fetchImpl: fetch,
    config: readProductionValues(readWranglerConfig()),
  });
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
