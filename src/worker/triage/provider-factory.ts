// Picks the triage provider from TRIAGE_PROVIDER (SPEC 10.3). workers-ai without an AI
// binding is reported as misconfigured, and the Workflow then records keyword-fallback.
import { OpenAiCompatProvider } from "../../shared/triage/providers/openai-compatible.ts";
import { StubProvider } from "../../shared/triage/providers/stub.ts";
import type { LlmProvider } from "../../shared/triage/providers/types.ts";
import { type AiLike, WorkersAiProvider } from "../../shared/triage/providers/workers-ai.ts";
import type { Config } from "../config.ts";

export type ProviderChoice = { status: "ready"; provider: LlmProvider } | { status: "misconfigured"; provider: null; reason: string };

export function createTriageProvider(env: { AI?: unknown }, config: Pick<Config, "triageProvider" | "triageModel" | "aiGatewayId" | "llmBaseUrl" | "llmModel">): ProviderChoice {
  switch (config.triageProvider) {
    case "workers-ai":
      if (!env.AI) return { status: "misconfigured", provider: null, reason: "TRIAGE_PROVIDER=workers-ai but no AI binding" };
      return { status: "ready", provider: new WorkersAiProvider(env.AI as AiLike, config.triageModel, config.aiGatewayId) };
    case "openai-compat":
      return { status: "ready", provider: new OpenAiCompatProvider(config.llmBaseUrl, config.llmModel) };
    case "stub":
      return { status: "ready", provider: new StubProvider() };
  }
}
