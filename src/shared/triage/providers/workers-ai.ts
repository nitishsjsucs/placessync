// Workers AI with JSON mode (SPEC 10.3). Takes any object shaped like the Ai binding, so
// this file has no cloudflare imports and is tested with a fake.
import type { CompleteJsonRequest, LlmProvider } from "./types.ts";
import { LlmTransportError } from "./types.ts";

export interface AiLike {
  run(model: string, inputs: Record<string, unknown>, options?: Record<string, unknown>): Promise<unknown>;
}

export class WorkersAiProvider implements LlmProvider {
  readonly id = "workers-ai" as const;
  readonly model: string;
  private readonly ai: AiLike;
  private readonly gatewayId: string | undefined;

  constructor(ai: AiLike, model: string, gatewayId?: string) {
    this.ai = ai;
    this.model = model;
    this.gatewayId = gatewayId || undefined;
  }

  async completeJson(req: CompleteJsonRequest): Promise<{ text: string }> {
    let out: unknown;
    try {
      out = await this.ai.run(
        this.model,
        {
          messages: [
            { role: "system", content: req.system },
            { role: "user", content: req.user },
          ],
          // Cloudflare JSON mode takes the schema directly under json_schema.
          response_format: { type: "json_schema", json_schema: req.schema },
          max_tokens: req.maxTokens,
          temperature: req.temperature,
        },
        this.gatewayId ? { gateway: { id: this.gatewayId } } : undefined,
      );
    } catch (err) {
      // Includes "JSON Mode couldn't be met": the Workflow step retries, then falls back.
      throw new LlmTransportError(`Workers AI failed: ${err instanceof Error ? err.message : String(err)}`);
    }
    const response = (out as { response?: unknown } | null)?.response;
    if (typeof response === "string") return { text: response };
    if (response && typeof response === "object") return { text: JSON.stringify(response) };
    throw new LlmTransportError("Workers AI returned no response");
  }
}
