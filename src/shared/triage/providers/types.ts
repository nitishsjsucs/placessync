// The pluggable LLM provider (SPEC 10.2). Implementations: Workers AI (production),
// an OpenAI-compatible server such as llama.cpp (local evals), and a keyword stub.
export type JsonSchema = Record<string, unknown>;

export type ProviderId = "workers-ai" | "openai-compat" | "stub";

export interface CompleteJsonRequest {
  system: string;
  user: string;
  schema: JsonSchema;
  maxTokens: number;
  temperature: number;
  signal?: AbortSignal;
}

export interface LlmProvider {
  readonly id: ProviderId;
  readonly model: string;
  completeJson(req: CompleteJsonRequest): Promise<{ text: string }>;
}

/** A transport or server failure: retried by the Workflow step. */
export class LlmTransportError extends Error {
  readonly status: number | null;
  constructor(message: string, status: number | null = null) {
    super(message);
    this.status = status;
  }
}

/** The prompt does not fit the server's per-slot context (SPEC 10.3, 13.2). */
export class ContextOverflowError extends Error {}
