/**
 * Bithy Brains — shared contracts.
 *
 * These interfaces are the boundary between Bithy (the agent) and Bithy Brains
 * (the intelligence infrastructure). No application is hard-coded as "the brain".
 */

export type BithyIntent =
  | "question"
  | "conversation"
  | "knowledge_search"
  | "memory_search"
  | "data_analysis"
  | "application_action"
  | "document_analysis"
  | "task_creation"
  | "technical_help"
  | "general_assistance";

export interface BrainRequest {
  message: string;
  conversationId?: string | undefined;
  userId: string;
  application?: string | undefined;
  page?: string | undefined;
  context?: Record<string, unknown> | undefined;
}

export interface BrainSource {
  id: string;
  title: string;
  relevance: number;
}

export interface BrainAction {
  type: string;
  payload: Record<string, string | number | boolean | null>;
}

export interface BrainResponse {
  message: string;
  conversationId: string;
  reasoning?: {
    intent: string;
    toolsUsed: string[];
  };
  sources?: BrainSource[];
  actions?: BrainAction[];
}

export interface RetrievedMemory {
  id: string;
  content: string;
  memory_type: string;
  importance: number;
  similarity: number;
}

export interface RetrievedChunk {
  id: string;
  document_id: string;
  title: string;
  content: string;
  similarity: number;
}

export interface BrainContext {
  userId: string;
  application?: string | undefined;
  page?: string | undefined;
  conversationId: string;
  currentTask: string;
  clientContext: Record<string, unknown>;
  recentMessages: Array<{ role: string; content: string }>;
  summary?: string | undefined;
  relevantMemories: RetrievedMemory[];
  relevantDocuments: RetrievedChunk[];
  personality: PersonalityProfile;
}

export interface PersonalityProfile {
  tone: string;
  style: string;
  responseLength: string;
  formality: string;
  language: string;
  assistantName: string;
}

export interface ToolContext {
  userId: string;
  application?: string | undefined;
  query: string;
  queryEmbedding?: number[] | undefined;
}

export interface ToolResult {
  ok: boolean;
  summary: string;
  data?: unknown;
  sources?: BrainSource[];
  actions?: BrainAction[];
  error?: string;
}

export interface BithyTool {
  id: string;
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  permissions: string[];
  destructive: boolean;
  execute: (ctx: ToolContext) => Promise<ToolResult>;
}

export interface ExecutionTrace {
  intent: BithyIntent;
  toolsUsed: string[];
  memoryMs: number;
  ragMs: number;
  modelMs: number;
  modelId: string;
  provider: string;
  success: boolean;
  error?: string | undefined;
}
