// One map from provider id to the label the UI shows (SPEC 14.1). "AI" appears only for
// workers-ai; the stub and the keyword fallback are never presented as AI.
export const SUGGESTION_PROVIDERS = ["workers-ai", "openai-compat", "stub", "keyword-fallback"] as const;
export type SuggestionProvider = (typeof SUGGESTION_PROVIDERS)[number];

export const PROVIDER_LABELS: Record<SuggestionProvider, string> = {
  "workers-ai": "Workers AI",
  "openai-compat": "Local Qwen3-1.7B (llama.cpp)",
  stub: "Keyword stub (keyword-v1)",
  "keyword-fallback": "Keyword fallback",
};

export function providerLabel(provider: string): string {
  return (PROVIDER_LABELS as Record<string, string>)[provider] ?? provider;
}

export function isAiProvider(provider: string): boolean {
  return provider === "workers-ai";
}
