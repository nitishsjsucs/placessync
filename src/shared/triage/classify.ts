// classifyRequest (SPEC 10.2): build the prompt, call the provider, validate the output.
// Throws on transport errors and schema-invalid output so the Workflow step retries.
import { MAX_TOKENS, SYSTEM_PROMPT, type TriageInput, renderRequest } from "./prompt.ts";
import type { LlmProvider, ProviderId } from "./providers/types.ts";
import { TRIAGE_JSON_SCHEMA, type TriageOutput, parseTriageOutput } from "./schema.ts";

export interface Classification extends TriageOutput {
  provider: ProviderId;
  model: string;
  latencyMs: number;
}

export function triageRequest(input: TriageInput) {
  return {
    system: SYSTEM_PROMPT,
    user: renderRequest(input),
    schema: TRIAGE_JSON_SCHEMA as unknown as Record<string, unknown>,
    maxTokens: MAX_TOKENS,
    temperature: 0,
  };
}

export async function classifyRequest(
  provider: LlmProvider,
  input: TriageInput,
  opts: { signal?: AbortSignal; now?: () => number } = {},
): Promise<Classification> {
  const now = opts.now ?? (() => Date.now());
  const started = now();
  const { text } = await provider.completeJson({ ...triageRequest(input), signal: opts.signal });
  const out = parseTriageOutput(text);
  return { ...out, provider: provider.id, model: provider.model, latencyMs: Math.max(0, Math.round(now() - started)) };
}
