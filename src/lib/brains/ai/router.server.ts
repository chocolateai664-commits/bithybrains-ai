import { chatComplete, providerOf, ProviderError, type ChatMessage, type ChatResult } from "./provider.server";
import type { Db } from "../db.server";
import type { BithyIntent } from "../types";

/**
 * Model router — selects a model from task type, then falls back on failure.
 *
 * Configuration lives in the `ai_models` registry (provider, task types,
 * status, priority, cost tier, context size) so routing can be changed without
 * a deploy. The static catalog below is only a bootstrap fallback used when the
 * registry is unreachable or empty; existing fallback behaviour is preserved.
 */

export interface ModelCandidate {
  modelId: string;
  provider: string;
  tasks: BithyIntent[] | "*";
  costTier: string;
  priority: number;
  contextSize: number | null;
}

const STATIC_CATALOG: ModelCandidate[] = [
  {
    modelId: "openai/gpt-5.6-sol",
    provider: "openai",
    tasks: ["data_analysis", "technical_help", "document_analysis", "application_action", "task_creation"],
    costTier: "premium",
    priority: 10,
    contextSize: null,
  },
  { modelId: "google/gemini-3.5-flash", provider: "google", tasks: "*", costTier: "standard", priority: 20, contextSize: null },
];

const DEFAULT_MODEL = "google/gemini-3.5-flash";

/** Approximate token budget for a prompt, used to respect `context_size`. */
function estimateTokens(messages: ChatMessage[]): number {
  return Math.ceil(messages.reduce((total, m) => total + m.content.length, 0) / 4);
}

async function loadCatalog(db?: Db): Promise<ModelCandidate[]> {
  if (!db) return STATIC_CATALOG;
  try {
    const { data, error } = await db
      .from("ai_models")
      .select("model_id, provider, task_types, cost_tier, status, priority, context_size")
      .eq("status", "active")
      .order("priority", { ascending: true });
    if (error || !data || data.length === 0) return STATIC_CATALOG;
    return data.map((row) => ({
      modelId: row.model_id,
      provider: row.provider,
      tasks: row.task_types.includes("*") ? "*" : (row.task_types as BithyIntent[]),
      costTier: row.cost_tier,
      priority: row.priority,
      contextSize: row.context_size,
    }));
  } catch {
    return STATIC_CATALOG;
  }
}

/** Ordered chain: capability match first, then generalists, then everything else. */
export function buildChain(
  catalog: ModelCandidate[],
  intent: BithyIntent,
  estimatedTokens = 0,
): string[] {
  const fits = (c: ModelCandidate) => !c.contextSize || estimatedTokens === 0 || estimatedTokens <= c.contextSize;
  const byPriority = (a: ModelCandidate, b: ModelCandidate) => a.priority - b.priority;

  const capable = catalog.filter((c) => c.tasks !== "*" && c.tasks.includes(intent) && fits(c)).sort(byPriority);
  const generalists = catalog.filter((c) => c.tasks === "*" && fits(c)).sort(byPriority);
  const remainder = catalog.filter((c) => !capable.includes(c) && !generalists.includes(c)).sort(byPriority);

  const chain = [...capable, ...generalists, ...remainder].map((c) => c.modelId);
  const unique = Array.from(new Set(chain));
  return unique.length > 0 ? unique : [DEFAULT_MODEL];
}

export function selectModel(intent: BithyIntent, catalog: ModelCandidate[] = STATIC_CATALOG): string {
  return buildChain(catalog, intent)[0] ?? DEFAULT_MODEL;
}

export async function routeChat(
  intent: BithyIntent,
  messages: ChatMessage[],
  db?: Db,
): Promise<ChatResult> {
  const catalog = await loadCatalog(db);
  const chain = buildChain(catalog, intent, estimateTokens(messages));

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
