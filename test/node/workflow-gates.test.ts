import { describe, expect, it } from "vitest";
import { type WorkflowOutcome, workflowGates } from "../../scripts/lib/workflow-gates.ts";

const ok = (provider: string, category = "electrical_av"): WorkflowOutcome => ({ reached: true, provider, category });

describe("workflow-mode triage gates (SPEC 13.2)", () => {
  it("passes when every request reached review with a model suggestion in the enum", () => {
    const g = workflowGates(3, [ok("openai-compat"), ok("openai-compat", "building_systems"), ok("openai-compat", "cleaning_safety")]);
    expect(g).toEqual({ reachedReview: 3, providerCounts: { "openai-compat": 3 }, categoryInEnum: 3, failures: [] });
  });

  it("reports a keyword fallback without failing, as long as the model produced some suggestions", () => {
    const g = workflowGates(2, [ok("openai-compat"), ok("keyword-fallback")]);
    expect(g.providerCounts).toEqual({ "openai-compat": 1, "keyword-fallback": 1 });
    expect(g.failures).toEqual([]);
  });

  it("fails a run whose app used the stub, so it cannot be reported as the model's", () => {
    const g = workflowGates(2, [ok("stub"), ok("stub")]);
    expect(g.failures).toHaveLength(2);
    expect(g.failures[0]).toMatch(/2 suggestions came from neither openai-compat nor keyword-fallback/);
    expect(g.failures[1]).toBe("no suggestion came from openai-compat");
  });

  it("fails when one stub suggestion is mixed into model suggestions", () => {
    expect(workflowGates(2, [ok("openai-compat"), ok("stub")]).failures).toEqual([
      "1 suggestions came from neither openai-compat nor keyword-fallback: rebuild with TRIAGE_PROVIDER=openai-compat in .dev.vars",
    ]);
  });

  it("fails when a request never reached review", () => {
    const g = workflowGates(2, [ok("openai-compat"), { reached: false, provider: null, category: null }]);
    expect(g.reachedReview).toBe(1);
    expect(g.categoryInEnum).toBe(1);
    expect(g.failures).toEqual([
      "1 of 2 requests did not reach awaiting_review",
      "1 of 2 suggestions are missing or outside the four categories",
    ]);
  });

  it("fails on a category outside the four", () => {
    expect(workflowGates(1, [ok("openai-compat", "landscaping")]).failures).toEqual(["1 of 1 suggestions are missing or outside the four categories"]);
  });

  it("fails when fewer outcomes than requests were recorded", () => {
    expect(workflowGates(2, [ok("openai-compat")]).failures[0]).toBe("1 outcomes recorded for 2 requests");
  });
});
