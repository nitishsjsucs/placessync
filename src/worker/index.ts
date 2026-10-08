import { createApp, defaultDeps } from "./app.ts";

export { SiteLedger } from "./ledger/site-ledger.ts";
export { TriageWorkflow } from "./triage/triage-workflow.ts";

const app = createApp(defaultDeps);

export default {
  fetch: (request, env, ctx) => app.fetch(request, env, ctx),
} satisfies ExportedHandler<Env>;
