import { createApp, defaultDeps } from "./app.ts";
import { parseConfig } from "./config.ts";
import { sweepStrandedRequests } from "./triage/sweep.ts";

export { SiteLedger } from "./ledger/site-ledger.ts";
export { TriageWorkflow } from "./triage/triage-workflow.ts";

const app = createApp(defaultDeps);

export default {
  fetch: (request, env, ctx) => app.fetch(request, env, ctx),
  /** Cron "*\/2 * * * *": the stranded-request sweep (SPEC 7.3). */
  async scheduled(controller, env, ctx) {
    const parsed = parseConfig(env as unknown as Record<string, unknown>);
    if (!parsed.ok) {
      console.error("sweep skipped: misconfigured", parsed.issues);
      return;
    }
    ctx.waitUntil(
      sweepStrandedRequests(env, parsed.config, controller.scheduledTime).then((summary) => {
        if (summary.examined > 0) console.log("triage sweep", JSON.stringify(summary));
      }),
    );
  },
} satisfies ExportedHandler<Env>;
