import { DurableObject, WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";

export class SiteLedger extends DurableObject<Env> {}

export class TriageWorkflow extends WorkflowEntrypoint<Env, { requestId: string; siteId: string }> {
  async run(_event: WorkflowEvent<{ requestId: string; siteId: string }>, _step: WorkflowStep): Promise<void> {}
}

export default {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/api/health") return Response.json({ ok: true });
    return Response.json({ error: "not_found" }, { status: 404 });
  },
} satisfies ExportedHandler<Env>;
