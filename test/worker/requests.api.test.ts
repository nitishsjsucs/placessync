import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";
import { createApp, defaultDeps } from "../../src/worker/app.ts";
import { startTriage } from "../../src/worker/triage/start-triage.ts";
import { eventTypes, insertRequest, requestRow } from "../helpers/requests.ts";
import { ADMIN, EMPLOYEE, EMPLOYEE_2, STAFF, authHeaders, tokenFor } from "../helpers/tokens.ts";
import { withWorkflows } from "../helpers/workflows.ts";
import { BASE, as, json, seed } from "../helpers/world.ts";

beforeAll(async () => {
  await seed();
});

const valid = { siteId: "hq", title: "Projector has no signal", description: "The projector in Sequoia shows no signal from the HDMI cable.", resourceId: "res_sequoia" };
type Created = { request: { id: string; status: string; triageState: string }; triage: string };

/** An app whose Workflow binding is replaced, sharing the real env otherwise. */
function appWith(triageWorkflow: (typeof defaultDeps)["triageWorkflow"]) {
  const app = createApp({ ...defaultDeps, triageWorkflow });
  return async (path: string, init: RequestInit) => {
    const ctx = createExecutionContext();
    const res = await app.fetch(new Request(`${BASE}${path}`, init), env, ctx);
    await waitOnExecutionContext(ctx);
    return res;
  };
}

describe("POST /api/requests (SPEC 7.3)", () => {
  it("inserts the request and starts the workflow with id = request id", async () => {
    await withWorkflows(async (intro) => {
      const user = await as(EMPLOYEE);
      const res = await user.post("/api/requests", valid);
      expect(res.status).toBe(201);
      const body = await json<Created>(res);
      expect(body.triage).toBe("started");
      expect(body.request.id).toMatch(/^req_[0-9a-z]{26}$/);
      expect(body.request.status).toBe("submitted");
      const instances = await intro.get();
      expect(instances).toHaveLength(1);
      await instances[0]?.waitForStatus("complete");
      expect((await env.TRIAGE_WORKFLOW.get(body.request.id)).id).toBe(body.request.id);
      expect(await requestRow(body.request.id)).toMatchObject({ workflow_instance_id: body.request.id, triage_attempts: 1, status: "awaiting_review" });
      expect(await eventTypes(body.request.id)).toEqual(["submitted", "triage_started", "triaged", "review_overdue"]);
    });
  });

  it("answers 201 with triage pending and leaves the row submitted when create throws", async () => {
    const send = appWith(() => ({
      create: async () => {
        throw new Error("workflows unavailable");
      },
      get: async () => {
        throw new Error("instance.not_found");
      },
    }));
    const res = await send("/api/requests", {
      method: "POST",
      headers: { "content-type": "application/json", ...authHeaders(await tokenFor(EMPLOYEE)) },
      body: JSON.stringify(valid),
    });
    expect(res.status).toBe(201);
    const body = await json<Created>(res);
    expect(body.triage).toBe("pending");
    expect(await requestRow(body.request.id)).toMatchObject({ status: "submitted", triage_state: "pending", triage_attempts: 1, workflow_instance_id: null });
    expect(await eventTypes(body.request.id)).toEqual(["submitted"]);
  });

  it("counts a duplicate create (already_exists) as started", async () => {
    await withWorkflows(async () => {
      const user = await as(EMPLOYEE);
      const body = await json<Created>(await user.post("/api/requests", valid));
      const again = await startTriage(env, env.TRIAGE_WORKFLOW, body.request.id, "hq", Date.now());
      expect(again).toBe(true);
      expect((await requestRow(body.request.id))?.triage_attempts).toBe(2);
    });
  });

  it("maps validation errors to fields", async () => {
    const user = await as(EMPLOYEE);
    const res = await user.post("/api/requests", { siteId: "hq", title: "abc", description: "too short" });
    expect(res.status).toBe(422);
    const body = await json<{ issues: { path: string }[] }>(res);
    expect(body.issues.map((i) => i.path).sort()).toEqual(["description", "title"]);
  });

  it("rejects an unknown siteId and a resource from elsewhere with 422", async () => {
    const user = await as(EMPLOYEE);
    const site = await user.post("/api/requests", { ...valid, siteId: "evil" });
    expect(site.status).toBe(422);
    expect((await json<{ issues: { path: string }[] }>(site)).issues[0]?.path).toBe("siteId");
    const resource = await user.post("/api/requests", { ...valid, resourceId: "res_nope" });
    expect(resource.status).toBe(422);
    expect((await json<{ issues: { path: string }[] }>(resource)).issues[0]?.path).toBe("resourceId");
  });
});

describe("reading requests", () => {
  it("lists only the caller's own requests, and detail is owner or staff only", async () => {
    const mine = await insertRequest({ reporterId: EMPLOYEE_2 });
    await insertRequest({ reporterId: EMPLOYEE });
    const b = await as(EMPLOYEE_2);
    const list = await json<{ requests: { id: string; reporterId: string }[] }>(await b.get("/api/requests"));
    expect(list.requests.every((r) => r.reporterId === EMPLOYEE_2)).toBe(true);
    expect(list.requests.map((r) => r.id)).toContain(mine);
    expect((await b.get(`/api/requests/${mine}`)).status).toBe(200);
    expect((await (await as(STAFF)).get(`/api/requests/${mine}`)).status).toBe(200);
    const other = await (await as(EMPLOYEE)).get(`/api/requests/${mine}`);
    expect(other.status).toBe(404);
    await other.body?.cancel();
  });

  it("the staff queue includes submitted rows older than 2 minutes as pending, not fresh ones", async () => {
    const old = await insertRequest({ ageMinutes: 5 });
    const fresh = await insertRequest({ ageMinutes: 0 });
    const staff = await as(STAFF);
    const body = await json<{ requests: { id: string; triageState: string; ageMinutes: number }[] }>(await staff.get("/api/staff/requests"));
    const ids = body.requests.map((r) => r.id);
    expect(ids).toContain(old);
    expect(ids).not.toContain(fresh);
    expect(body.requests.find((r) => r.id === old)).toMatchObject({ triageState: "pending" });
  });
});

describe("staff review (SPEC 7.3 conditional write)", () => {
  async function suggested(category = "electrical_av") {
    const id = await insertRequest({ status: "awaiting_review", triageState: "suggested" });
    await env.DB.prepare(
      "INSERT INTO triage_suggestions (request_id, category, confidence, rationale, provider, model, attempts, latency_ms, created_at) VALUES (?, ?, 0.8, 'r', 'stub', 'keyword-v1', 1, 0, ?)",
    )
      .bind(id, category, new Date().toISOString())
      .run();
    return id;
  }

  it("accept assigns the suggested category", async () => {
    const id = await suggested("electrical_av");
    const res = await (await as(STAFF)).post(`/api/staff/requests/${id}/review`, { decision: "accept" });
    expect(res.status).toBe(200);
    await res.body?.cancel();
    expect(await requestRow(id)).toMatchObject({ status: "assigned", final_category: "electrical_av", review_decision: "accepted", reviewed_by: STAFF });
    expect(await eventTypes(id)).toEqual(["reviewed"]);
  });

  it("reassign stores the staff category", async () => {
    const id = await suggested("electrical_av");
    const res = await (await as(ADMIN)).post(`/api/staff/requests/${id}/review`, { decision: "reassign", category: "building_systems" });
    expect(res.status).toBe(200);
    await res.body?.cancel();
    expect(await requestRow(id)).toMatchObject({ final_category: "building_systems", review_decision: "reassigned" });
  });

  it("categorize works on a submitted row with no suggestion and records manual", async () => {
    const id = await insertRequest({ status: "submitted", triageState: "pending" });
    const res = await (await as(STAFF)).post(`/api/staff/requests/${id}/review`, { decision: "categorize", category: "furniture_fixtures" });
    expect(res.status).toBe(200);
    await res.body?.cancel();
    expect(await requestRow(id)).toMatchObject({ status: "assigned", final_category: "furniture_fixtures", review_decision: "manual" });
  });

  it("accept on a row with no suggestion is 409 not_reviewable and writes no event", async () => {
    const id = await insertRequest({ status: "awaiting_review", triageState: "unavailable" });
    const res = await (await as(STAFF)).post(`/api/staff/requests/${id}/review`, { decision: "accept" });
    expect(res.status).toBe(409);
    expect((await json(res)).error).toBe("not_reviewable");
    expect(await eventTypes(id)).toEqual([]);
  });

  it("two concurrent reviews give exactly one 200, one 409 and one reviewed event", async () => {
    const id = await suggested();
    const a = await as(STAFF);
    const b = await as(ADMIN);
    const [r1, r2] = await Promise.all([
      a.post(`/api/staff/requests/${id}/review`, { decision: "accept" }),
      b.post(`/api/staff/requests/${id}/review`, { decision: "reassign", category: "cleaning_safety" }),
    ]);
    expect([r1.status, r2.status].sort()).toEqual([200, 409]);
    await r1.body?.cancel();
    await r2.body?.cancel();
    expect((await eventTypes(id)).filter((t) => t === "reviewed")).toHaveLength(1);
  });

  it("after the review commits, sends review_outcome { outcome: reviewed, at } to that request's workflow", async () => {
    const id = await suggested("electrical_av");
    const sent: { id: string; event: unknown }[] = [];
    const send = appWith(() => ({
      create: async () => {
        throw new Error("unused");
      },
      get: async (instanceId: string) => ({ sendEvent: async (event: unknown) => void sent.push({ id: instanceId, event }) }) as unknown as WorkflowInstance,
    }));
    const res = await send(`/api/staff/requests/${id}/review`, {
      method: "POST",
      headers: { ...authHeaders(await tokenFor(STAFF)), "content-type": "application/json" },
      body: JSON.stringify({ decision: "accept" }),
    });
    expect(res.status).toBe(200);
    await res.body?.cancel();
    const row = await requestRow(id);
    expect(sent).toEqual([{ id, event: { type: "review_outcome", payload: { outcome: "reviewed", at: row?.reviewed_at } } }]);
    // A 409 review sends nothing.
    const again = await send(`/api/staff/requests/${id}/review`, {
      method: "POST",
      headers: { ...authHeaders(await tokenFor(STAFF)), "content-type": "application/json" },
      body: JSON.stringify({ decision: "accept" }),
    });
    expect(again.status).toBe(409);
    await again.body?.cancel();
    expect(sent).toHaveLength(1);
  });

  it("enforces the status machine: illegal transitions are 409", async () => {
    const id = await suggested();
    const staff = await as(STAFF);
    const early = await staff.post(`/api/staff/requests/${id}/status`, { status: "in_progress" });
    expect(early.status).toBe(409);
    expect((await json(early)).error).toBe("invalid_transition");
    await (await staff.post(`/api/staff/requests/${id}/review`, { decision: "accept" })).body?.cancel();
    const start = await staff.post(`/api/staff/requests/${id}/status`, { status: "in_progress" });
    expect(start.status).toBe(200);
    await start.body?.cancel();
    const done = await staff.post(`/api/staff/requests/${id}/status`, { status: "resolved", note: "Replaced the cable." });
    expect(done.status).toBe(200);
    await done.body?.cancel();
    const back = await staff.post(`/api/staff/requests/${id}/status`, { status: "in_progress" });
    expect(back.status).toBe(409);
    await back.body?.cancel();
    expect(await eventTypes(id)).toEqual(["reviewed", "status_changed", "status_changed"]);
  });
});

describe("reporter cancel", () => {
  it("cancels a request nobody picked up and sends review_outcome to its workflow", async () => {
    const id = await insertRequest({ reporterId: EMPLOYEE, status: "awaiting_review", triageState: "suggested" });
    const sent: { id: string; event: unknown }[] = [];
    const send = appWith(() => ({
      create: async () => {
        throw new Error("unused");
      },
      get: async (instanceId: string) => ({ sendEvent: async (event: unknown) => void sent.push({ id: instanceId, event }) }) as unknown as WorkflowInstance,
    }));
    const res = await send(`/api/requests/${id}/cancel`, { method: "POST", headers: authHeaders(await tokenFor(EMPLOYEE)) });
    expect(res.status).toBe(200);
    await res.body?.cancel();
    expect(await requestRow(id)).toMatchObject({ status: "cancelled" });
    expect(sent).toEqual([{ id, event: { type: "review_outcome", payload: { outcome: "cancelled", at: expect.any(String) } } }]);
    expect(await eventTypes(id)).toEqual(["cancelled"]);
  });

  it("refuses to cancel an assigned request and someone else's request", async () => {
    const assigned = await insertRequest({ reporterId: EMPLOYEE, status: "assigned", triageState: "suggested" });
    const user = await as(EMPLOYEE);
    const res = await user.post(`/api/requests/${assigned}/cancel`);
    expect(res.status).toBe(409);
    await res.body?.cancel();
    const theirs = await insertRequest({ reporterId: EMPLOYEE_2 });
    const other = await user.post(`/api/requests/${theirs}/cancel`);
    expect(other.status).toBe(404);
    await other.body?.cancel();
  });
});
