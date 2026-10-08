import { DurableObject, WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";
import { createApp, defaultDeps } from "./app.ts";

export class SiteLedger extends DurableObject<Env> {}

export class TriageWorkflow extends WorkflowEntrypoint<Env, { requestId: string; siteId: string }> {
  async run(_event: WorkflowEvent<{ requestId: string; siteId: string }>, _step: WorkflowStep): Promise<void> {}
}

const app = createApp(defaultDeps);

export default {
  fetch: (request, env, ctx) => app.fetch(request, env, ctx),
} satisfies ExportedHandler<Env>;
