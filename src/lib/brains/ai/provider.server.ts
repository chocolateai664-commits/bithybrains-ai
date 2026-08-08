/**
 * AI provider abstraction. Every model call in Bithy Brains goes through here,
 * so providers can be swapped without touching the intelligence layer.
 */

const GATEWAY = "https://ai.gateway.lovable.dev/v1";

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatResult {
  text: string;
  modelId: string;
  provider: string;
  promptTokens: number;
  completionTokens: number;
  latencyMs: number;
}

export class ProviderError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

function apiKey(): string {
  const key = process.env["LOVABLE_API_KEY"];
  if (!key) throw new ProviderError(500, "AI provider is not configured");
  return key;
}

export function providerOf(modelId: string): string {
  return modelId.split("/")[0] ?? "unknown";
}

export async function chatComplete(
  modelId: string,
  messages: ChatMessage[],
): Promise<ChatResult> {
  const started = Date.now();
  const body: Record<string, unknown> = { model: modelId, messages };
  if (modelId.startsWith("openai/gpt-5.6")) body["reasoning_effort"] = "none";

  const res = await fetch(`${GATEWAY}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Lovable-API-Key": apiKey(),
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new ProviderError(res.status, detail.slice(0, 500) || res.statusText);
  }

  const json = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };

  return {
    text: json.choices?.[0]?.message?.content ?? "",
    modelId,
    provider: providerOf(modelId),
    promptTokens: json.usage?.prompt_tokens ?? 0,
    completionTokens: json.usage?.completion_tokens ?? 0,
    latencyMs: Date.now() - started,
  };
}

export const EMBEDDING_MODEL = "google/gemini-embedding-2";

export async function embed(input: string): Promise<number[]> {
  const res = await fetch(`${GATEWAY}/embeddings`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Lovable-API-Key": apiKey(),
    },
    body: JSON.stringify({ model: EMBEDDING_MODEL, input }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new ProviderError(res.status, detail.slice(0, 500) || res.statusText);
  }

  const json = (await res.json()) as { data?: Array<{ embedding?: number[] }> };
  const vector = json.data?.[0]?.embedding;
  if (!vector) throw new ProviderError(502, "Embedding provider returned no vector");
  return vector;
}

export async function embedBatch(inputs: string[]): Promise<number[][]> {
  const out: number[][] = [];
  // Gemini embeddings cap at 100 inputs per request.
  for (let i = 0; i < inputs.length; i += 50) {
    const batch = inputs.slice(i, i + 50);
    const res = await fetch(`${GATEWAY}/embeddings`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Lovable-API-Key": apiKey(),
      },
      body: JSON.stringify({ model: EMBEDDING_MODEL, input: batch }),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new ProviderError(res.status, detail.slice(0, 500) || res.statusText);
    }
    const json = (await res.json()) as {
      data?: Array<{ embedding: number[]; index: number }>;
    };
    const sorted = (json.data ?? []).slice().sort((a, b) => a.index - b.index);
    for (const row of sorted) out.push(row.embedding);
  }
  return out;
}
