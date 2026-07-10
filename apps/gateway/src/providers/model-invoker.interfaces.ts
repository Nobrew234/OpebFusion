/**
 * The provider/model-invoker seam (ADR 0007, spec 004). This is the lowest
 * application layer: the orchestration engine (spec 002) depends on it, but it
 * depends on nothing above it — it knows nothing about routes, public models,
 * or the HTTP contract. Spec 004 fills this seam with real provider adapters
 * (OpenRouter via the Vercel AI SDK); until then a deterministic fake stands
 * in, so the orchestration engine can be built and tested without any live
 * provider call (AGENTS.md: never call a real provider in tests).
 */

export type InvocationRole = 'system' | 'user' | 'assistant' | 'tool';

export interface ModelToolCall {
  /** Provider-assigned id, used to correlate a tool result back to its call. */
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface InvocationMessage {
  role: InvocationRole;
  content: string;
  /** Present on an assistant message that requested tool calls. */
  toolCalls?: ModelToolCall[];
  /** Present on a tool-result message: the id of the call it answers. */
  toolCallId?: string;
  /** Present on a tool-result message: the tool name it answers. */
  name?: string;
}

export interface ToolSpec {
  name: string;
  description: string;
  /** JSON Schema for the tool arguments. */
  parameters: Record<string, unknown>;
}

export type InvocationFinishReason =
  'stop' | 'length' | 'tool_calls' | 'content_filter';

export interface InvocationUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface ModelInvocationRequest {
  /** Internal model key (e.g. `worker.fast`), never a public/provider id. */
  modelKey: string;
  messages: InvocationMessage[];
  /** Tools offered to the model; omitted/empty means no tool calling. */
  tools?: ToolSpec[];
  temperature?: number;
  topP?: number;
  maxTokens?: number;
  stop?: string | string[];
  timeoutMs?: number;
}

export interface ModelInvocationResult {
  content: string;
  toolCalls: ModelToolCall[];
  finishReason: InvocationFinishReason;
  usage: InvocationUsage;
}

export interface ModelStreamChunk {
  /** Incremental content; empty string on the terminal chunk. */
  delta: string;
  /** Non-null only on the terminal chunk. */
  finishReason: InvocationFinishReason | null;
  usage?: InvocationUsage;
}

export const MODEL_INVOKER = Symbol('MODEL_INVOKER');

/**
 * A provider-agnostic model call. Concrete adapters (spec 004) normalize
 * provider errors and usage metadata behind this interface, so nothing above
 * it needs to know which provider answered.
 */
export interface ModelInvoker {
  invoke(request: ModelInvocationRequest): Promise<ModelInvocationResult>;
  stream(request: ModelInvocationRequest): AsyncIterable<ModelStreamChunk>;
}
