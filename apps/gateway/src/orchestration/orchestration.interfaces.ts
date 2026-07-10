import type { ToolSpec } from '../providers/model-invoker.interfaces';

export type ChatRole = 'system' | 'user' | 'assistant' | 'tool';

export interface ChatMessage {
  role: ChatRole;
  content: string;
}

export interface OrchestrationRequest {
  publicModel: string;
  messages: ChatMessage[];
  temperature?: number;
  topP?: number;
  maxTokens?: number;
  stop?: string | string[];
  /**
   * Client-supplied external tools, already normalized to internal ToolSpec.
   * Present ONLY when the active route sets `allowExternalTools` (spec 005
   * "Tool calling"); otherwise the HTTP layer drops them so they never reach a
   * provider. `delegate_llm` is never among these — it is injected internally
   * and is invisible to the client.
   */
  externalTools?: ToolSpec[];
}

/**
 * A client-visible tool call surfaced in the final answer (spec 005 Fase 5/6:
 * "tool calls finais permitidas"). `arguments` is JSON-encoded to match the
 * OpenAI `tool_calls[].function.arguments` string field. Internal
 * `delegate_llm` calls are NEVER represented here.
 */
export interface FinalToolCall {
  id: string;
  name: string;
  arguments: string;
}

/**
 * Public finish reasons exposed in the Chat Completions envelope (spec 005
 * "Finish reasons"): `stop` (natural end), `length` (token cap hit),
 * `tool_calls` (the final answer requests client-visible tools), and
 * `content_filter` (the provider signalled a block). `error` stays internal —
 * it is converted to an HTTP error before reaching the client, never a
 * finish_reason value.
 */
export type FinishReason = 'stop' | 'length' | 'tool_calls' | 'content_filter';

export interface OrchestrationUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface OrchestrationResult {
  content: string;
  finishReason: FinishReason;
  usage: OrchestrationUsage;
  /**
   * Present only when the final answer requests client-visible (external)
   * tools; `finishReason` is then `tool_calls`. Internal delegations never
   * appear here.
   */
  toolCalls?: FinalToolCall[];
}

export interface OrchestrationChunk {
  /** Incremental content for this chunk; empty string on the terminal chunk. */
  delta: string;
  /** Non-null only on the terminal chunk. */
  finishReason: FinishReason | null;
}

export const ORCHESTRATION_SERVICE = Symbol('ORCHESTRATION_SERVICE');

/**
 * Seam standing in for spec 002's LLM-orchestrated routing engine, which does
 * not exist yet. Spec 001 only needs a deterministic target behind this
 * interface so the HTTP contract (envelope, SSE framing, error mapping) can
 * be built and tested for real without a live provider call.
 */
export interface OrchestrationService {
  generate(request: OrchestrationRequest): Promise<OrchestrationResult>;
  stream(request: OrchestrationRequest): AsyncIterable<OrchestrationChunk>;
}
