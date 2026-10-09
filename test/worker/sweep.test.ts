import { createExecutionContext, createScheduledController, introspectWorkflowInstance, waitOnExecutionContext } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";
import worker from "../../src/worker/index.ts";
import { sweepStrandedRequests } from "../../src/worker/triage/sweep.ts";
import { eventTypes, insertRequest, requestRow } from "../helpers/requests.ts";
import { seed } from "../helpers/world.ts";

beforeAll(async () => {
  await seed();
  await env.DB.exec("DELETE FROM request_events");
  await env.DB.exec("DELETE FROM triage_suggestions");
  await env.DB.exec("DELETE FROM facilities_requests");
});

/** Runs the exported scheduled handler at an injected time (SPEC 12.1). */
async function runSweep(nowMs = Date.now()) {
  const controller = createScheduledController({ cron: "*/2 * * * *", scheduledTime: nowMs });
  const ctx = createExecutionContext();
  await worker.scheduled(controller, env, ctx);
  await waitOnExecutionContext(ctx);
}

async function clearSubmitted() {
  await env.DB.exec("UPDATE facilities_requests SET status = 'cancelled' WHERE status = 'submitted'");
}

describe("cron sweep for stranded requests (SPEC 7.3, ADR 0008)", () => {
  it("(a) creates an instance for an old submitted row that has none", async () => {
    await clearSubmitted();
    const id = await insertRequest({ ageMinutes: 5 });
    await using instance = await introspectWorkflowInstance(env.TRIAGE_WORKFLOW, id);
    await instance.modify(async (m) => {
      await m.disableSleeps();
      await m.forceEventTimeout({ name: "review-outcome" });
    });
    await runSweep();
    expect((await requestRow(id))?.triage_attempts).toBe(1);
    await instance.waitForStatus("complete");
    expect(await requestRow(id)).toMatchObject({ status: "awaiting_review", triage_state: "suggested", workflow_instance_id: id });
    expect((await eventTypes(id))[0]).toBe("triage_started");
  });

  it("(b) restarts an errored instance, which then reaches awaiting_review", async () => {
    await clearSubmitted();
    const id = `req_sweep_b${Date.now().toString(36)}`;
    await using instance = await introspectWorkflowInstance(env.TRIAGE_WORKFLOW, id);
    await instance.modify(async (m) => {
      await m.disableSleeps();
      await m.forceEventTimeout({ name: "review-outcome" });
    });
    // The row does not exist yet, so load-request fails and the instance ends errored.
    await env.TRIAGE_WORKFLOW.create({ id, params: { requestId: id, siteId: "hq" } });
    await instance.waitForStatus("errored");
    await insertRequest({ id, ageMinutes: 5, triageAttempts: 1 });
    await runSweep();
    expect(await requestRow(id)).toMatchObject({ triage_attempts: 2 });
    expect(await eventTypes(id)).toContain("triage_retry");
    const deadline = Date.now() + 10_000;
    while ((await requestRow(id))?.status !== "awaiting_review" && Date.now() < deadline) await new Promise((r) => setTimeout(r, 25));
    expect(await requestRow(id)).toMatchObject({ status: "awaiting_review", triage_state: "suggested" });
  });

  it("(c) leaves a row younger than 2 minutes alone", async () => {
    await clearSubmitted();
    const id = await insertRequest({ ageMinutes: 1 });
    await runSweep();
    expect(await requestRow(id)).toMatchObject({ status: "submitted", triage_attempts: 0 });
    expect(await eventTypes(id)).toEqual([]);
  });

  it("(d) leaves a running instance alone", async () => {
    await clearSubmitted();
    const id = await insertRequest({ ageMinutes: 5, triageAttempts: 1 });
    await using instance = await introspectWorkflowInstance(env.TRIAGE_WORKFLOW, id);
    await instance.modify(async (m) => {
      await m.disableSleeps();
      // Pretend the suggestion was recorded, so D1 still says submitted while the
      // instance waits for the review event.
      await m.mockStepResult({ name: "record-suggestion" }, { recorded: true });
    });
    await env.TRIAGE_WORKFLOW.create({ id, params: { requestId: id, siteId: "hq" } });
    // The local engine reports "running" while an instance waits for an event.
    await instance.waitForStepResult({ name: "notify-staff" });
    await runSweep();
    expect(await requestRow(id)).toMatchObject({ status: "submitted", triage_attempts: 1 });
    expect(await eventTypes(id)).toEqual([]);
    await (await env.TRIAGE_WORKFLOW.get(id)).sendEvent({ type: "review_outcome", payload: { outcome: "reviewed", at: new Date().toISOString() } });
    await instance.waitForStatus("complete");
  });

  it("(e) hands a row at 3 attempts to staff as unavailable", async () => {
    await clearSubmitted();
    const id = await insertRequest({ ageMinutes: 5, triageAttempts: 3 });
    await runSweep();
    expect(await requestRow(id)).toMatchObject({ status: "awaiting_review", triage_state: "unavailable" });
    expect(await eventTypes(id)).toEqual(["triage_unavailable"]);
  });

  it("two overlapping sweep runs at the same instant hand a row off once, with one event", async () => {
    await clearSubmitted();
    const id = await insertRequest({ ageMinutes: 5, triageAttempts: 3 });
    const now = Date.now();
    const [a, b] = await Promise.all([sweepStrandedRequests(env, { siteId: "hq" }, now), sweepStrandedRequests(env, { siteId: "hq" }, now)]);
    expect(a.handedOff + b.handedOff).toBe(1);
    expect(await requestRow(id)).toMatchObject({ status: "awaiting_review", triage_state: "unavailable" });
    expect(await eventTypes(id)).toEqual(["triage_unavailable"]);
  });

  it("hands off a row whose instance completed without recording anything", async () => {
    await clearSubmitted();
    const id = await insertRequest({ ageMinutes: 5, triageAttempts: 1 });
    await using instance = await introspectWorkflowInstance(env.TRIAGE_WORKFLOW, id);
    await instance.modify(async (m) => {
      await m.disableSleeps();
      await m.mockStepResult({ name: "record-suggestion" }, { recorded: false });
    });
    await env.TRIAGE_WORKFLOW.create({ id, params: { requestId: id, siteId: "hq" } });
    await instance.waitForStatus("complete");
    await runSweep();
    expect(await requestRow(id)).toMatchObject({ status: "awaiting_review", triage_state: "unavailable" });
  });

  it("(f) examines at most 25 rows per run", async () => {
    await clearSubmitted();
    const ids: string[] = [];
    for (let i = 0; i < 30; i++) ids.push(await insertRequest({ ageMinutes: 10 + i, triageAttempts: 3 }));
    await runSweep();
    const { results } = await env.DB.prepare(
      `SELECT status, COUNT(*) AS n FROM facilities_requests WHERE id IN (${ids.map(() => "?").join(",")}) GROUP BY status ORDER BY status`,
    )
      .bind(...ids)
      .all();
    expect(results).toEqual([
      { status: "awaiting_review", n: 25 },
      { status: "submitted", n: 5 },
    ]);
  });

  it("staff can categorize a handed-off request by hand", async () => {
    await clearSubmitted();
    const id = await insertRequest({ ageMinutes: 5, triageAttempts: 3 });
    await runSweep();
    const { as } = await import("../helpers/world.ts");
    const res = await (await as("emp_094")).post(`/api/staff/requests/${id}/review`, { decision: "categorize", category: "cleaning_safety" });
    expect(res.status).toBe(200);
    await res.body?.cancel();
    expect(await requestRow(id)).toMatchObject({ status: "assigned", review_decision: "manual", final_category: "cleaning_safety" });
  });
});
