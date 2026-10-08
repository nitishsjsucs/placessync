import { introspectWorkflowInstance } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";
import { CATEGORIES } from "../../src/shared/triage/categories.ts";
import { eventTypes, insertRequest, requestRow, suggestionRow } from "../helpers/requests.ts";
import { seed } from "../helpers/world.ts";

beforeAll(async () => {
  await seed();
});

const params = (requestId: string) => ({ requestId, siteId: "hq" });
const reviewed = () => ({ type: "review_outcome", payload: { outcome: "reviewed", at: new Date().toISOString() } });

describe("TriageWorkflow (SPEC 7.3)", () => {
  it("stub provider path: suggestion recorded, request awaiting_review, review event observed", async () => {
    const id = await insertRequest({});
    await using instance = await introspectWorkflowInstance(env.TRIAGE_WORKFLOW, id);
    await instance.modify(async (m) => {
      await m.disableSleeps();
      await m.mockEvent(reviewed());
    });
    await env.TRIAGE_WORKFLOW.create({ id, params: params(id) });
    await instance.waitForStatus("complete");
    expect(await instance.getOutput()).toEqual({ recorded: true, outcome: "reviewed" });
    expect(await requestRow(id)).toMatchObject({ status: "awaiting_review", triage_state: "suggested" });
    const s = await suggestionRow(id);
    expect(CATEGORIES).toContain(s?.category);
    expect(s).toMatchObject({ provider: "stub", model: "keyword-v1", category: "electrical_av" });
    expect(await eventTypes(id)).toEqual(["triaged", "review_observed"]);
  });

  it("falls back to the keyword classifier when classify exhausts its retries", async () => {
    const id = await insertRequest({ title: "Water on the floor", description: "Water keeps dripping from a pipe under the sink." });
    await using instance = await introspectWorkflowInstance(env.TRIAGE_WORKFLOW, id);
    await instance.modify(async (m) => {
      await m.disableSleeps();
      await m.disableRetryDelays();
      await m.mockStepError({ name: "classify" }, new Error("provider down"));
      await m.forceEventTimeout({ name: "review-outcome" });
    });
    await env.TRIAGE_WORKFLOW.create({ id, params: params(id) });
    await instance.waitForStatus("complete");
    expect(await suggestionRow(id)).toMatchObject({ provider: "keyword-fallback", model: "keyword-v1", category: "building_systems" });
    expect(await requestRow(id)).toMatchObject({ status: "awaiting_review", triage_state: "suggested" });
  });

  it("a review timeout on a still-awaiting request records review_overdue and completes (not errored)", async () => {
    const id = await insertRequest({});
    await using instance = await introspectWorkflowInstance(env.TRIAGE_WORKFLOW, id);
    await instance.modify(async (m) => {
      await m.disableSleeps();
      await m.forceEventTimeout({ name: "review-outcome" });
    });
    await env.TRIAGE_WORKFLOW.create({ id, params: params(id) });
    await instance.waitForStatus("complete");
    expect(await instance.getOutput()).toEqual({ recorded: true, outcome: "overdue" });
    expect(await eventTypes(id)).toEqual(["triaged", "review_overdue"]);
  });

  it("a review timeout after a review that D1 already holds records review_observed and no overdue alert", async () => {
    const id = await insertRequest({});
    // The review happened and its sendEvent was lost: D1 already says assigned.
    const triagedAt = new Date(Date.now() - 30 * 60_000).toISOString();
    const reviewedAt = new Date(Date.now() - 10 * 60_000).toISOString();
    await env.DB.batch([
      env.DB.prepare("UPDATE facilities_requests SET status = 'assigned', triage_state = 'suggested', review_decision = 'accepted', final_category = 'electrical_av', reviewed_by = 'emp_093', reviewed_at = ? WHERE id = ?").bind(reviewedAt, id),
      env.DB.prepare("INSERT INTO request_events (request_id, type, data, at) VALUES (?, 'triaged', '{}', ?)").bind(id, triagedAt),
    ]);
    await using instance = await introspectWorkflowInstance(env.TRIAGE_WORKFLOW, id);
    await instance.modify(async (m) => {
      await m.disableSleeps();
      await m.mockStepResult({ name: "record-suggestion" }, { recorded: true });
      await m.forceEventTimeout({ name: "review-outcome" });
    });
    await env.TRIAGE_WORKFLOW.create({ id, params: params(id) });
    await instance.waitForStatus("complete");
    // "observed" is the branch that sends no triage_overdue notification.
    expect(await instance.getOutput()).toEqual({ recorded: true, outcome: "observed" });
    const types = await eventTypes(id);
    expect(types).toContain("review_observed");
    expect(types).not.toContain("review_overdue");
    const observed = await env.DB.prepare("SELECT data FROM request_events WHERE request_id = ? AND type = 'review_observed'").bind(id).first<{ data: string }>();
    expect(JSON.parse(observed?.data ?? "{}")).toMatchObject({ outcome: "reviewed", minutes: 20, viaTimeout: true });
  });

  it("a request reviewed by hand before the suggestion lands completes without notifying or waiting", async () => {
    const id = await insertRequest({});
    await env.DB.prepare("UPDATE facilities_requests SET status = 'assigned', review_decision = 'manual', final_category = 'furniture_fixtures' WHERE id = ?").bind(id).run();
    await using instance = await introspectWorkflowInstance(env.TRIAGE_WORKFLOW, id);
    await instance.modify(async (m) => {
      await m.disableSleeps();
    });
    await env.TRIAGE_WORKFLOW.create({ id, params: params(id) });
    await instance.waitForStatus("complete");
    expect(await instance.getOutput()).toEqual({ recorded: false, outcome: "superseded" });
    expect(await requestRow(id)).toMatchObject({ status: "assigned", review_decision: "manual", final_category: "furniture_fixtures" });
    expect(await suggestionRow(id)).not.toBeNull();
  });

  it("record-suggestion failing past its retries ends the instance errored with the request still submitted", async () => {
    const id = await insertRequest({});
    await using instance = await introspectWorkflowInstance(env.TRIAGE_WORKFLOW, id);
    await instance.modify(async (m) => {
      await m.disableSleeps();
      await m.disableRetryDelays();
      await m.mockStepError({ name: "record-suggestion" }, new Error("D1 outage"));
    });
    await env.TRIAGE_WORKFLOW.create({ id, params: params(id) });
    await instance.waitForStatus("errored");
    expect((await instance.getError()).message).toContain("D1 outage");
    expect(await requestRow(id)).toMatchObject({ status: "submitted", triage_state: "pending" });
  });

  it("a missing request fails load-request without retries", async () => {
    const id = "req_missing_row";
    await using instance = await introspectWorkflowInstance(env.TRIAGE_WORKFLOW, id);
    await instance.modify(async (m) => {
      await m.disableSleeps();
    });
    await env.TRIAGE_WORKFLOW.create({ id, params: params(id) });
    await instance.waitForStatus("errored");
  });
});

describe("TriageWorkflow with an unavailable provider", () => {
  it("records keyword-fallback when TRIAGE_PROVIDER=workers-ai has no AI binding", async () => {
    const { runTriage } = await import("../../src/worker/triage/triage-workflow.ts");
    const id = await insertRequest({ title: "Trash everywhere", description: "The trash bin by the kitchen is overflowing again today." });
    const steps: string[] = [];
    // A minimal in-process step runner: runs each step once and times out the wait.
    const step = {
      do: async (name: string, a: unknown, b?: unknown) => {
        steps.push(name);
        const fn = (typeof a === "function" ? a : b) as (ctx: { attempt: number }) => Promise<unknown>;
        return fn({ attempt: 1 });
      },
      waitForEvent: async () => {
        throw new Error("timeout");
      },
      sleep: async () => undefined,
      sleepUntil: async () => undefined,
    };
    const out = await runTriage({ ...env, TRIAGE_PROVIDER: "workers-ai" } as Env, { requestId: id, siteId: "hq" }, step as never);
    expect(steps).toEqual(["load-request", "classify-fallback", "record-suggestion", "notify-staff", "flag-overdue"]);
    expect(out).toEqual({ recorded: true, outcome: "overdue" });
    expect(await suggestionRow(id)).toMatchObject({ provider: "keyword-fallback", category: "cleaning_safety" });
  });
});
