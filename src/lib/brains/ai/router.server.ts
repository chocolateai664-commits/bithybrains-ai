import { chatComplete, providerOf, ProviderError, type ChatMessage, type ChatResult } from "./provider.server";
import type { BithyIntent } from "../types";

/**
 * Model router — selects a model from task type, then falls back on failure.
 * Capability/latency/cost weighting lives here so the rest of the brain never
 * hard-codes a provider.
 */

interface ModelCandidate {
  modelId: string;
  tasks: BithyIntent[] | "*";
  costTier: "standard" | "premium";
}

const CATALOG: ModelCandidate[] = [
  {
    modelId: "openai/gpt-5.6-sol",
    tasks: ["data_analysis", "technical_help", "document_analysis", "application_action", "task_creation"],
    costTier: "premium",
  },
  { modelId: "google/gemini-3.5-flash", tasks: "*", costTier: "standard" },
];

const FALLBACK_ORDER = ["google/gemini-3.5-flash", "openai/gpt-5.6-sol"];

export function selectModel(intent: BithyIntent): string {
  const match = CATALOG.find((c) => c.tasks !== "*" && c.tasks.includes(intent));
  return match?.modelId ?? "google/gemini-3.5-flash";
}

export async function routeChat(
  intent: BithyIntent,
  messages: ChatMessage[],
): Promise<ChatResult> {
  const primary = selectModel(intent);
  const chain = [primary, ...FALLBACK_ORDER.filter((m) => m !== primary)];

  let lastError: unknown;
  for (const modelId of chain) {
    try {
      return await chatComplete(modelId, messages);
    } catch (error) {
      lastError = error;
      // 402/403 are account-level and will not improve on a fallback model.
      if (error instanceof ProviderError && (error.status === 402 || error.status === 403)) throw error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error("All AI providers failed");
}

export { providerOf };
