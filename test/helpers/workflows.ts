// introspectWorkflow wrappers (SPEC 12, Workflows in tests). Any test that makes the API
// create a TriageWorkflow instance with a server-generated id runs it with sleeps
// disabled and ends it through a forced review timeout, so no instance sits in a
// 24-hour waitForEvent inside the test runtime.
import { introspectWorkflow } from "cloudflare:test";
import { env } from "cloudflare:workers";

export type WorkflowIntrospector = Awaited<ReturnType<typeof introspectWorkflow>>;

/** Introspects TRIAGE_WORKFLOW so every new instance skips sleeps and times out its review wait. */
export async function introspectTriage(): Promise<WorkflowIntrospector> {
  const intro = await introspectWorkflow(env.TRIAGE_WORKFLOW);
  await intro.modifyAll(async (m) => {
    await m.disableSleeps();
    await m.forceEventTimeout({ name: "review-outcome" });
  });
  return intro;
}

/** Waits until every captured instance has completed. */
export async function waitForAllComplete(intro: WorkflowIntrospector): Promise<void> {
  for (const i of await intro.get()) await i.waitForStatus("complete");
}

/** Runs fn with TRIAGE_WORKFLOW introspected, waits for every instance it created, then disposes. */
export async function withWorkflows<T>(fn: (intro: WorkflowIntrospector) => Promise<T>): Promise<T> {
  await using intro = await introspectTriage();
  const out = await fn(intro);
  await waitForAllComplete(intro);
  return out;
}
