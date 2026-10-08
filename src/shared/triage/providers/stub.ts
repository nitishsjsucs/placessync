// Deterministic offline provider: wraps the keyword classifier. Not an LLM, and labeled
// "Keyword stub (keyword-v1)" everywhere it shows up.
import { classifyByKeywords } from "../keyword-classifier.ts";
import type { CompleteJsonRequest, LlmProvider } from "./types.ts";

export class StubProvider implements LlmProvider {
  readonly id = "stub" as const;
  readonly model = "keyword-v1";

  async completeJson(req: CompleteJsonRequest): Promise<{ text: string }> {
    const { category, confidence, rationale } = classifyByKeywords(req.user);
    return { text: JSON.stringify({ category, confidence, rationale }) };
  }
}
