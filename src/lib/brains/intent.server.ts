import type { BithyIntent } from "./types";

/**
 * Intent classification. Rules first (cheap, deterministic) so the brain avoids
 * unnecessary model calls; unresolved cases fall back to "general_assistance".
 */

const RULES: Array<{ intent: BithyIntent; patterns: RegExp[] }> = [
  { intent: "memory_search", patterns: [/\b(remember|recall|what did i|my preference|you know about me)\b/i] },
  { intent: "knowledge_search", patterns: [/\b(document|doc|pdf|according to|in the (guide|spec|manual)|knowledge base)\b/i] },
  { intent: "document_analysis", patterns: [/\b(summari[sz]e|analy[sz]e) (the |this |my )?(document|file|pdf|report)\b/i] },
  { intent: "data_analysis", patterns: [/\b(performance|metrics|stats|statistics|analytics|trend|report on|how many)\b/i] },
  { intent: "task_creation", patterns: [/\b(create|add|new) (a )?(task|todo|ticket|reminder)\b/i] },
  { intent: "application_action", patterns: [/\b(update|delete|send|deploy|trigger|run)\b.*\b(task|record|notification|job)\b/i] },
  { intent: "technical_help", patterns: [/\b(error|bug|stack trace|api|endpoint|code|typescript|sql)\b/i] },
  { intent: "conversation", patterns: [/^\s*(hi|hey|hello|thanks|thank you|good (morning|evening)|how are you)\b/i] },
  { intent: "question", patterns: [/^(what|why|how|when|who|where|can|does|is|are)\b/i] },
];

export interface IntentDecision {
  intent: BithyIntent;
  needsMemory: boolean;
  needsRag: boolean;
  needsTools: boolean;
  needsModel: boolean;
}

export function classifyIntent(message: string): IntentDecision {
  const intent = RULES.find((r) => r.patterns.some((p) => p.test(message)))?.intent ?? "general_assistance";

  const needsRag = ["knowledge_search", "document_analysis", "question", "technical_help"].includes(intent);
  const needsMemory = intent !== "conversation";
  const needsTools = [
    "memory_search",
    "knowledge_search",
    "data_analysis",
    "application_action",
    "task_creation",
    "document_analysis",
  ].includes(intent);

  return { intent, needsMemory, needsRag, needsTools, needsModel: true };
}
