// Provider-independent AI interface. Providers return structured output that is validated by the caller's zod schema.
import { z, ZodType } from "zod";
import { env } from "../env";
import { AppError } from "../errors";

export interface CompleteRequest<T> { system: string; prompt: string; schema: ZodType<T>; promptId: string; maxTokens?: number }
export interface AiProvider {
  id: string;
  /** External providers send content over the network and are subject to the AI policy gate. */
  external: boolean;
  complete<T>(req: CompleteRequest<T>): Promise<T>;
}

async function postJson(url: string, headers: Record<string, string>, body: unknown, timeoutMs = 45_000) {
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs), redirect: "error" });
  if (!res.ok) throw new AppError(502, "ai_provider_error", `AI provider returned HTTP ${res.status}`);
  return res.json() as Promise<any>;
}

/** Anthropic Messages API with forced tool use for structured output. (Verified against mocks only: see docs/known-limitations.md.) */
export class AnthropicProvider implements AiProvider {
  id = "anthropic"; external = true;
  constructor(private apiKey: string, private model: string, private baseUrl = "https://api.anthropic.com") {}
  async complete<T>(r: CompleteRequest<T>): Promise<T> {
    const json = await postJson(`${this.baseUrl}/v1/messages`, { "x-api-key": this.apiKey, "anthropic-version": "2023-06-01" }, {
      model: this.model, max_tokens: r.maxTokens ?? 1500, system: r.system, messages: [{ role: "user", content: r.prompt }],
      tools: [{ name: "respond", description: "Return the structured result", input_schema: z.toJSONSchema(r.schema) }], tool_choice: { type: "tool", name: "respond" },
    });
    const block = (json.content ?? []).find((b: { type: string }) => b.type === "tool_use");
    if (!block) throw new AppError(502, "ai_bad_output", "AI provider returned no structured output");
    return r.schema.parse(block.input);
  }
}

export class OpenAiCompatibleProvider implements AiProvider {
  id = "openai-compatible"; external = true;
  constructor(private apiKey: string, private model: string, private baseUrl: string) {}
  async complete<T>(r: CompleteRequest<T>): Promise<T> {
    const json = await postJson(`${this.baseUrl.replace(/\/$/, "")}/chat/completions`, { authorization: `Bearer ${this.apiKey}` }, {
      model: this.model, max_tokens: r.maxTokens ?? 1500, messages: [{ role: "system", content: r.system }, { role: "user", content: r.prompt }],
      response_format: { type: "json_schema", json_schema: { name: "respond", schema: z.toJSONSchema(r.schema), strict: false } },
    });
    const text = json.choices?.[0]?.message?.content;
    if (typeof text !== "string") throw new AppError(502, "ai_bad_output", "AI provider returned no content");
    let parsed: unknown; try { parsed = JSON.parse(text); } catch { throw new AppError(502, "ai_bad_output", "AI provider returned invalid JSON"); }
    return r.schema.parse(parsed);
  }
}

/** Marker provider: the local deterministic rules engine handles tasks directly (see tasks.ts / qa.ts); it never calls out. */
export class LocalRulesProvider implements AiProvider {
  id = "local-rules"; external = false;
  async complete<T>(): Promise<T> { throw new AppError(501, "not_generative", "The local rules provider is not a generative model"); }
}

let override: AiProvider | null | undefined;
export const setAiProviderForTests = (p: AiProvider | null | undefined) => { override = p; };

/** The configured external provider, or null when none is configured (the product then runs on local rules only). */
export function configuredExternalProvider(): AiProvider | null {
  if (override !== undefined) return override;
  const e = env();
  if (e.AI_PROVIDER === "anthropic" && e.AI_API_KEY) return new AnthropicProvider(e.AI_API_KEY, e.AI_MODEL ?? "claude-sonnet-5-5", e.AI_BASE_URL);
  if (e.AI_PROVIDER === "openai-compatible" && e.AI_API_KEY && e.AI_BASE_URL && e.AI_MODEL) return new OpenAiCompatibleProvider(e.AI_API_KEY, e.AI_MODEL, e.AI_BASE_URL);
  return null;
}
export const localProvider = new LocalRulesProvider();
