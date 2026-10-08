import { describe, expect, it } from "vitest";
import { classifyRequest } from "../../src/shared/triage/classify.ts";
import { OpenAiCompatProvider } from "../../src/shared/triage/providers/openai-compatible.ts";
import { ContextOverflowError, LlmTransportError } from "../../src/shared/triage/providers/types.ts";
import { WorkersAiProvider } from "../../src/shared/triage/providers/workers-ai.ts";
import { TRIAGE_JSON_SCHEMA } from "../../src/shared/triage/schema.ts";
import { createTriageProvider } from "../../src/worker/triage/provider-factory.ts";
import { fakeAi } from "../helpers/fake-ai.ts";

const input = { title: "Leak by the window", description: "Water is dripping from the window frame onto the carpet." };
const MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";
const answer = { category: "building_systems", confidence: 0.9, rationale: "A leak." };

describe("WorkersAiProvider with a fake Ai binding", () => {
  it("sends the model id, messages and JSON-mode response_format with the schema under json_schema", async () => {
    const ai = fakeAi({ response: JSON.stringify(answer) });
    const out = await classifyRequest(new WorkersAiProvider(ai, MODEL), input);
    expect(out).toMatchObject({ category: "building_systems", provider: "workers-ai", model: MODEL });
    const call = ai.calls[0];
    expect(call?.model).toBe(MODEL);
    expect(call?.inputs.response_format).toEqual({ type: "json_schema", json_schema: TRIAGE_JSON_SCHEMA });
    expect(call?.inputs).toMatchObject({ max_tokens: 160, temperature: 0 });
    expect((call?.inputs.messages as { role: string }[]).map((m) => m.role)).toEqual(["system", "user"]);
    expect(call?.options).toBeUndefined();
  });

  it("passes the gateway option only when AI_GATEWAY_ID is set", async () => {
    const ai = fakeAi({ response: answer });
    await classifyRequest(new WorkersAiProvider(ai, MODEL, "gw-1"), input);
    expect(ai.calls[0]?.options).toEqual({ gateway: { id: "gw-1" } });
    const none = fakeAi({ response: answer });
    await classifyRequest(new WorkersAiProvider(none, MODEL, ""), input);
    expect(none.calls[0]?.options).toBeUndefined();
  });

  it("accepts response as a string or an already-parsed object", async () => {
    for (const response of [JSON.stringify(answer), answer]) {
      const out = await classifyRequest(new WorkersAiProvider(fakeAi({ response }), MODEL), input);
      expect(out.category).toBe("building_systems");
    }
  });

  it("surfaces JSON-mode failures as retryable transport errors", async () => {
    const ai = fakeAi(() => new Error("JSON Mode couldn't be met"));
    await expect(classifyRequest(new WorkersAiProvider(ai, MODEL), input)).rejects.toThrow(LlmTransportError);
  });
});

describe("OpenAiCompatProvider with a fake fetch", () => {
  function fakeFetch(status: number, body: unknown) {
    const calls: { url: string; init: RequestInit }[] = [];
    const fetchImpl = async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response(typeof body === "string" ? body : JSON.stringify(body), { status });
    };
    return { calls, fetchImpl };
  }

  it("posts to {baseUrl}/chat/completions with strict json_schema, seed, temperature 0 and thinking off", async () => {
    const f = fakeFetch(200, { choices: [{ message: { content: JSON.stringify(answer) } }] });
    const out = await classifyRequest(new OpenAiCompatProvider("http://127.0.0.1:8130/v1/", "qwen3-1.7b", f.fetchImpl), input);
    expect(out).toMatchObject({ category: "building_systems", provider: "openai-compat", model: "qwen3-1.7b" });
    expect(f.calls[0]?.url).toBe("http://127.0.0.1:8130/v1/chat/completions");
    const body = JSON.parse(String(f.calls[0]?.init.body)) as Record<string, unknown>;
    expect(body).toMatchObject({
      model: "qwen3-1.7b",
      temperature: 0,
      seed: 7,
      max_tokens: 160,
      response_format: { type: "json_schema", json_schema: { name: "triage", strict: true, schema: TRIAGE_JSON_SCHEMA } },
      chat_template_kwargs: { enable_thinking: false },
    });
  });

  it("maps exceed_context_size_error to a distinct ContextOverflowError", async () => {
    const f = fakeFetch(400, { error: { type: "exceed_context_size_error", message: "too long" } });
    await expect(classifyRequest(new OpenAiCompatProvider("http://x/v1", "m", f.fetchImpl), input)).rejects.toThrow(ContextOverflowError);
  });

  it("maps other HTTP errors and malformed bodies to transport errors", async () => {
    await expect(classifyRequest(new OpenAiCompatProvider("http://x/v1", "m", fakeFetch(503, "busy").fetchImpl), input)).rejects.toThrow(LlmTransportError);
    await expect(classifyRequest(new OpenAiCompatProvider("http://x/v1", "m", fakeFetch(200, "not json").fetchImpl), input)).rejects.toThrow(LlmTransportError);
    await expect(classifyRequest(new OpenAiCompatProvider("http://x/v1", "m", fakeFetch(200, { choices: [] }).fetchImpl), input)).rejects.toThrow(LlmTransportError);
    const refused = async () => {
      throw new TypeError("connection refused");
    };
    await expect(classifyRequest(new OpenAiCompatProvider("http://x/v1", "m", refused), input)).rejects.toThrow(LlmTransportError);
  });
});

describe("createTriageProvider", () => {
  const base = { triageModel: MODEL, aiGatewayId: "", llmBaseUrl: "http://127.0.0.1:9/v1", llmModel: "m" };

  it("reports misconfigured for workers-ai without an AI binding", () => {
    expect(createTriageProvider({}, { ...base, triageProvider: "workers-ai" })).toMatchObject({ status: "misconfigured", provider: null });
  });

  it("builds each provider", () => {
    expect(createTriageProvider({ AI: fakeAi({}) }, { ...base, triageProvider: "workers-ai" }).provider?.id).toBe("workers-ai");
    expect(createTriageProvider({}, { ...base, triageProvider: "openai-compat" }).provider?.id).toBe("openai-compat");
    expect(createTriageProvider({}, { ...base, triageProvider: "stub" }).provider).toMatchObject({ id: "stub", model: "keyword-v1" });
  });
});

describe("provider labels (SPEC 14.1)", () => {
  it("says AI only for workers-ai", async () => {
    const { PROVIDER_LABELS, providerLabel } = await import("../../src/shared/triage/provider-labels.ts");
    expect(providerLabel("stub")).toBe("Keyword stub (keyword-v1)");
    expect(providerLabel("keyword-fallback")).toBe("Keyword fallback");
    expect(providerLabel("openai-compat")).toBe("Local Qwen3-1.7B (llama.cpp)");
    expect(providerLabel("workers-ai")).toBe("Workers AI");
    for (const [id, label] of Object.entries(PROVIDER_LABELS)) {
      if (id !== "workers-ai") expect(label).not.toMatch(/\bAI\b/);
    }
  });
});
