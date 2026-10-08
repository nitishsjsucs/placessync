// Gates for the workflow-mode triage eval (SPEC 13.2, Tier 2).
//
// The mode measures the TriageWorkflow calling the local model through the
// openai-compat provider. A suggestion from any other provider (stub, workers-ai) means
// the app was not built with TRIAGE_PROVIDER=openai-compat, so the run measured
// something else and must not be reported as the model's. A keyword-fallback suggestion
// is part of the Workflow's design (the model path failed after its retries), so it is
// reported in providerCounts and not gated.
import { CATEGORIES } from "../../src/shared/triage/categories.ts";

export interface WorkflowOutcome {
  reached: boolean;
  provider: string | null;
  category: string | null;
}

export interface WorkflowGateResult {
  reachedReview: number;
  providerCounts: Record<string, number>;
  categoryInEnum: number;
  failures: string[];
}

export function workflowGates(n: number, outcomes: readonly WorkflowOutcome[]): WorkflowGateResult {
  const reachedReview = outcomes.filter((o) => o.reached).length;
  const providerCounts: Record<string, number> = {};
  for (const o of outcomes) if (o.provider) providerCounts[o.provider] = (providerCounts[o.provider] ?? 0) + 1;
  const categoryInEnum = outcomes.filter((o) => o.category !== null && (CATEGORIES as readonly string[]).includes(o.category)).length;
  const fromOtherProviders = outcomes.filter((o) => o.provider !== null && o.provider !== "openai-compat" && o.provider !== "keyword-fallback").length;

  const failures: string[] = [];
  if (outcomes.length !== n) failures.push(`${outcomes.length} outcomes recorded for ${n} requests`);
  if (reachedReview !== n) failures.push(`${n - reachedReview} of ${n} requests did not reach awaiting_review`);
  if (categoryInEnum !== n) failures.push(`${n - categoryInEnum} of ${n} suggestions are missing or outside the four categories`);
  if (fromOtherProviders > 0) {
    failures.push(`${fromOtherProviders} suggestions came from neither openai-compat nor keyword-fallback: rebuild with TRIAGE_PROVIDER=openai-compat in .dev.vars`);
  }
  if ((providerCounts["openai-compat"] ?? 0) === 0) failures.push("no suggestion came from openai-compat");
  return { reachedReview, providerCounts, categoryInEnum, failures };
}
