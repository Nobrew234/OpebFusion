import { ToolSpec } from '../providers/model-invoker.interfaces';

/**
 * The internal `delegate_llm` tool (spec 002). It is ONLY ever offered to the
 * orchestrator model inside the engine — it is never exposed in the public
 * contract, never listed to the client, and never chooseable via the public
 * `tools`/`tool_choice` surface (AGENTS.md: "`delegate_llm` e interno").
 */
export const DELEGATE_LLM_TOOL_NAME = 'delegate_llm';

export interface DelegateLlmArgs {
  target_model: string;
  task: string;
  messages?: Array<{ role: string; content: string }>;
  output_contract?: string;
  reason?: string;
}

/**
 * Builds the tool schema shown to the orchestrator. `allowedModels` is baked
 * into the schema as an `enum` so the orchestrator is *steered* toward valid
 * targets — but this is advisory only. The backend still validates
 * `target_model` against the route's allow-list at execution time, because an
 * LLM can ignore the schema ("the orchestrator proposes; the backend
 * disposes").
 */
export function delegateLlmToolSpec(allowedModels: string[]): ToolSpec {
  const targetModelSchema: Record<string, unknown> = {
    type: 'string',
    description: 'Internal key of an allowed delegate model for this route.',
  };
  if (allowedModels.length > 0) {
    targetModelSchema.enum = [...allowedModels];
  }

  return {
    name: DELEGATE_LLM_TOOL_NAME,
    description:
      'Executa uma subtarefa em um modelo delegado permitido pela rota.',
    parameters: {
      type: 'object',
      required: ['target_model', 'task'],
      additionalProperties: false,
      properties: {
        target_model: targetModelSchema,
        task: {
          type: 'string',
          description: 'The subtask to run on the delegate model.',
        },
        messages: {
          type: 'array',
          description: 'Optional explicit message list for the delegate.',
        },
        output_contract: {
          type: 'string',
          description: 'Optional description of the expected output shape.',
        },
        reason: {
          type: 'string',
          description: 'Optional rationale for the delegation.',
        },
      },
    },
  };
}

export type DelegateArgsParseResult =
  { ok: true; args: DelegateLlmArgs } | { ok: false; error: string };

/**
 * Validates the raw arguments the orchestrator supplied for a `delegate_llm`
 * tool call. Returns a structured error (never throws) so the engine can hand
 * a normalized tool-result back to the orchestrator instead of crashing the
 * request on malformed tool input.
 */
export function parseDelegateArgs(
  raw: Record<string, unknown>,
): DelegateArgsParseResult {
  const targetModel = raw.target_model;
  if (typeof targetModel !== 'string' || targetModel.trim().length === 0) {
    return {
      ok: false,
      error: "'target_model' is required and must be a string.",
    };
  }
  const task = raw.task;
  if (typeof task !== 'string' || task.trim().length === 0) {
    return { ok: false, error: "'task' is required and must be a string." };
  }

  const args: DelegateLlmArgs = { target_model: targetModel, task };

  if (raw.messages !== undefined) {
    if (
      !Array.isArray(raw.messages) ||
      !raw.messages.every(
        (m) =>
          typeof m === 'object' &&
          m !== null &&
          typeof (m as { role?: unknown }).role === 'string' &&
          typeof (m as { content?: unknown }).content === 'string',
      )
    ) {
      return {
        ok: false,
        error: "'messages' must be an array of { role, content } objects.",
      };
    }
    args.messages = raw.messages as Array<{ role: string; content: string }>;
  }
  if (typeof raw.output_contract === 'string') {
    args.output_contract = raw.output_contract;
  }
  if (typeof raw.reason === 'string') {
    args.reason = raw.reason;
  }

  return { ok: true, args };
}
