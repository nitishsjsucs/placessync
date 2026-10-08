// Model output contract (SPEC 10.2): one of the four categories, a confidence in 0..1
// and a short rationale. The JSON Schema goes to the model; zod checks what comes back.
import { z } from "zod";
import { CATEGORIES, type Category } from "./categories.ts";

export const RATIONALE_MAX = 160;

export const TRIAGE_JSON_SCHEMA = {
  type: "object",
  properties: {
    category: { type: "string", enum: [...CATEGORIES] },
    confidence: { type: "number", minimum: 0, maximum: 1 },
    rationale: { type: "string", maxLength: RATIONALE_MAX },
  },
  required: ["category", "confidence", "rationale"],
  additionalProperties: false,
} as const;

export const TriageOutputSchema = z.object({
  category: z.enum(CATEGORIES),
  confidence: z
    .number()
    .refine(Number.isFinite, "confidence must be finite")
    .transform((c) => Math.min(1, Math.max(0, c))),
  // llama.cpp did not enforce maxLength in a verified run, so truncate here.
  rationale: z.string().transform((r) => r.trim().slice(0, RATIONALE_MAX)),
});

export interface TriageOutput {
  category: Category;
  confidence: number;
  rationale: string;
}

export class TriageOutputError extends Error {}

/** Parses model output (text or an already-parsed object). Throws TriageOutputError. */
export function parseTriageOutput(raw: string | unknown): TriageOutput {
  let value: unknown = raw;
  if (typeof raw === "string") {
    try {
      value = JSON.parse(raw);
    } catch {
      throw new TriageOutputError("model output is not JSON");
    }
  }
  const parsed = TriageOutputSchema.safeParse(value);
  if (!parsed.success) throw new TriageOutputError(`model output failed the schema: ${parsed.error.issues.map((i) => i.message).join("; ")}`);
  return parsed.data;
}
