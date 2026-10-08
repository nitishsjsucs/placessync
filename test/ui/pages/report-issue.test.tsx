import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { generateResources } from "../../../src/shared/synthetic/resources.ts";
import { HEALTH, type FakeApi, installFakeApi, me, respond } from "../fake-api.ts";
import { renderAt } from "../render-app.tsx";

const created = (triage: "started" | "pending") =>
  respond(201, {
    request: {
      id: "req_new",
      siteId: "hq",
      reporterId: "emp_001",
      reporterName: "Test Person",
      resourceId: null,
      resourceName: null,
      locationNote: "",
      title: "Projector has no signal",
      description: "The projector in Sequoia shows no signal from HDMI.",
      status: "submitted",
      triageState: "pending",
      triageAttempts: 1,
      finalCategory: null,
      reviewDecision: null,
      reviewedBy: null,
      reviewedAt: null,
      createdAt: "2026-10-08T15:00:00.000Z",
      updatedAt: "2026-10-08T15:00:00.000Z",
    },
    triage,
  });

let api: FakeApi;
function setup(triage: "started" | "pending") {
  api = installFakeApi({
    "GET /api/health": HEALTH,
    "GET /api/me": me("emp_001", "employee"),
    "GET /api/sites/hq/resources": { resources: generateResources() },
    "POST /api/requests": created(triage),
    "GET /api/requests/req_new": {
      request: (created(triage).body as { request: unknown }).request,
      suggestion: null,
      events: [{ id: 1, type: "submitted", actorId: "emp_001", data: {}, at: "2026-10-08T15:00:00.000Z" }],
    },
  });
}

beforeEach(() => setup("started"));
afterEach(() => vi.unstubAllGlobals());

describe("Report an issue (SPEC 14.1)", () => {
  it("validates on the client and moves focus to an error summary", async () => {
    renderAt("/requests/new");
    const user = userEvent.setup();
    await user.type(await screen.findByRole("textbox", { name: /^Title/ }), "abc");
    await user.type(screen.getByRole("textbox", { name: /^Description/ }), "too short");
    await user.click(screen.getByRole("button", { name: "Submit request" }));
    const summary = await screen.findByRole("alert");
    expect(document.activeElement).toBe(summary);
    expect(summary.textContent).toContain("Fix these 2 problems");
    expect(screen.getByRole("link", { name: "Title: Title needs at least 5 characters." }).getAttribute("href")).toBe("#issue-title");
    expect(screen.getByRole("textbox", { name: /^Title/ }).getAttribute("aria-invalid")).toBe("true");
    expect(screen.getByRole("textbox", { name: /^Description/ }).getAttribute("aria-invalid")).toBe("true");
    expect(api.calls.some((c) => c.method === "POST")).toBe(false);
  });

  it("submits and navigates to the request", async () => {
    const { router } = renderAt("/requests/new");
    const user = userEvent.setup();
    await user.type(await screen.findByRole("textbox", { name: /^Title/ }), "Projector has no signal");
    await user.type(screen.getByRole("textbox", { name: /^Description/ }), "The projector in Sequoia shows no signal from HDMI.");
    const space = screen.getByRole("combobox", { name: "Space (optional)" });
    await user.type(space, "sequ");
    await user.keyboard("{Enter}");
    await user.click(screen.getByRole("button", { name: "Submit request" }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/requests/req_new"));
    expect(api.calls.find((c) => c.method === "POST")?.body).toEqual({
      siteId: "hq",
      title: "Projector has no signal",
      description: "The projector in Sequoia shows no signal from HDMI.",
      resourceId: "res_sequoia",
    });
    expect(await screen.findByText(/It is being categorized automatically/)).toBeTruthy();
  });

  it("shows the pending message when triage could not start", async () => {
    setup("pending");
    renderAt("/requests/new");
    const user = userEvent.setup();
    await user.type(await screen.findByRole("textbox", { name: /^Title/ }), "Projector has no signal");
    await user.type(screen.getByRole("textbox", { name: /^Description/ }), "The projector in Sequoia shows no signal from HDMI.");
    await user.click(screen.getByRole("button", { name: "Submit request" }));
    expect(await screen.findByText("Your request was submitted. Classification pending; staff can still review it.")).toBeTruthy();
  });

  it("maps server 422 issues to fields", async () => {
    api.set("POST /api/requests", respond(422, { error: "validation", message: "x", issues: [{ path: "resourceId", code: "unknown_resource", message: "Pick a resource at this site." }] }));
    renderAt("/requests/new");
    const user = userEvent.setup();
    await user.type(await screen.findByRole("textbox", { name: /^Title/ }), "Projector has no signal");
    await user.type(screen.getByRole("textbox", { name: /^Description/ }), "The projector in Sequoia shows no signal from HDMI.");
    await user.click(screen.getByRole("button", { name: "Submit request" }));
    expect(await screen.findByRole("link", { name: "Space: Pick a resource at this site." })).toBeTruthy();
  });
});
