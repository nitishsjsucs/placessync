import type { AiLike } from "../../src/shared/triage/providers/workers-ai.ts";

/** A fake Workers AI binding that records calls and returns a scripted response. */
export function fakeAi(response: unknown | (() => unknown)): AiLike & { calls: { model: string; inputs: Record<string, unknown>; options?: Record<string, unknown> }[] } {
  const calls: { model: string; inputs: Record<string, unknown>; options?: Record<string, unknown> }[] = [];
  return {
    calls,
    async run(model, inputs, options) {
      calls.push({ model, inputs, options });
      const r = typeof response === "function" ? (response as () => unknown)() : response;
      if (r instanceof Error) throw r;
      return r;
    },
  };
}
