// OpenAI-compatible chat completions (verified against llama-server 0.5.0 with
// Qwen3-1.7B). Strict JSON-schema output, thinking disabled, temperature 0, fixed seed.
import { ContextOverflowError, type CompleteJsonRequest, type LlmProvider, LlmTransportError } from "./types.ts";

export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

export class OpenAiCompatProvider implements LlmProvider {
  readonly id = "openai-compat" as const;
  readonly model: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: FetchLike;

  constructor(baseUrl: string, model: string, fetchImpl: FetchLike = (i, init) => fetch(i, init)) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.model = model;
    this.fetchImpl = fetchImpl;
  }

  /** The request body, exposed so the eval pre-flight can tokenize exactly what is sent. */
  body(req: CompleteJsonRequest) {
    return {
      model: this.model,
      messages: [
        { role: "system", content: req.system },
        { role: "user", content: req.user },
      ],
      temperature: req.temperature,
      seed: 7,
      max_tokens: req.maxTokens,
      response_format: { type: "json_schema", json_schema: { name: "triage", strict: true, schema: req.schema } },
      chat_template_kwargs: { enable_thinking: false },
    };
  }

  async completeJson(req: CompleteJsonRequest): Promise<{ text: string }> {
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(this.body(req)),
        signal: req.signal,
      });
    } catch (err) {
      throw new LlmTransportError(`request failed: ${err instanceof Error ? err.message : String(err)}`);
    }
    const text = await res.text();
    if (!res.ok) {
      if (res.status === 400 && text.includes("exceed_context_size_error")) {
        throw new ContextOverflowError(`prompt exceeds the server context: ${text.slice(0, 200)}`);
      }
      throw new LlmTransportError(`HTTP ${res.status}: ${text.slice(0, 200)}`, res.status);
    }
    let parsed: { choices?: { message?: { content?: unknown } }[] };
    try {
      parsed = JSON.parse(text) as typeof parsed;
    } catch {
      throw new LlmTransportError("response is not JSON", res.status);
    }
    const content = parsed.choices?.[0]?.message?.content;
    if (typeof content !== "string") throw new LlmTransportError("response has no message content", res.status);
    return { text: content };
  }
}
