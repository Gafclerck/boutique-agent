import type { ApprovalPort } from '../ports/approval.js';
import type {
  ChatMessage,
  ChatResponse,
  LlmClient,
  TokenUsage,
  ToolCall,
  ToolDefinition,
} from '../ports/llm-client.js';
import type { ToolRegistry } from '../tools/registry.js';
import { evaluateToolGuard } from './guards.js';
import type {
  ApprovalTraceEvent,
  ToolCallTraceEvent,
  TraceEvent,
} from './trace.js';

export interface RunAgentParams {
  readonly llm: LlmClient;
  readonly tools: ToolRegistry;
  readonly instructions: string;
  readonly history?: readonly ChatMessage[];
  readonly userMessage: string;
  readonly maxSteps?: number;
  readonly maxTokens?: number;
  readonly approval?: ApprovalPort;
}

export interface AgentRunResult {
  readonly reply: string;
  readonly stopReason: 'answered' | 'max_steps' | 'empty_reply';
  readonly steps: number;
  readonly llmCalls: number;
  readonly usage: TokenUsage;
  readonly trace: readonly TraceEvent[];
  readonly messages: readonly ChatMessage[];
}

export const FALLBACK_MAX_STEPS_MESSAGE =
  "Je vous prie de m'excuser, je n'ai pas pu finaliser votre demande à temps. Pouvez-vous reformuler ou me préciser votre besoin ?";

export const FALLBACK_EMPTY_REPLY_MESSAGE =
  "Je vous prie de m'excuser, je n'ai pas pu formuler de réponse. Pouvez-vous reformuler ou préciser votre demande ?";

function computeTotalTokens(usage: TokenUsage): number {
  return usage.totalTokens ?? usage.promptTokens + usage.completionTokens;
}

export async function callModel(
  llm: LlmClient,
  messages: readonly ChatMessage[],
  tools: readonly ToolDefinition[],
  maxTokens?: number,
): Promise<ChatResponse> {
  return llm.chat({
    messages,
    tools,
    toolChoice: 'auto',
    maxTokens,
  });
}

export async function executeSingleToolCall(
  tools: ToolRegistry,
  toolCall: ToolCall,
  step: number,
  approval?: ApprovalPort,
): Promise<{
  result: Record<string, unknown>;
  event: ToolCallTraceEvent;
  approvalEvent?: ApprovalTraceEvent;
}> {
  const startTime = Date.now();
  let callArguments: unknown = toolCall.function.arguments;
  let result: Record<string, unknown>;
  let approvalEvent: ApprovalTraceEvent | undefined;

  try {
    const parsedArgs = toolCall.function.arguments
      ? JSON.parse(toolCall.function.arguments)
      : {};
    callArguments = parsedArgs;

    const tool = tools.get(toolCall.function.name);
    if (!tool) {
      result = {
        erreur: `outil inconnu "${toolCall.function.name}"`,
        conseil: 'utiliser uniquement les outils déclarés',
      };
    } else {
      const guard = await evaluateToolGuard(tool, parsedArgs, step, approval);
      approvalEvent = guard.approvalEvent;

      if (!guard.canExecute) {
        result = guard.directResult ?? { erreur: 'action non autorisée' };
      } else {
        try {
          result = await tool.execute(parsedArgs);
        } catch {
          result = {
            erreur: "erreur interne lors de l'exécution de l'outil",
          };
        }
      }
    }
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : 'Invalid JSON';
    result = {
      erreur: 'arguments JSON invalides',
      details: errorMsg,
    };
  }

  const durationMs = Date.now() - startTime;
  return {
    result,
    event: {
      type: 'tool_call',
      step,
      name: toolCall.function.name,
      arguments: callArguments,
      result,
      durationMs,
    },
    approvalEvent,
  };
}

export async function runAgent(params: RunAgentParams): Promise<AgentRunResult> {
  const boundedMaxSteps = Math.min(Math.max(params.maxSteps ?? 8, 1), 10);
  const toolDefinitions = params.tools.getDefinitions();

  const messages: ChatMessage[] = [
    { role: 'system', content: params.instructions },
    ...(params.history ?? []),
    { role: 'user', content: params.userMessage },
  ];

  const traceEvents: TraceEvent[] = [];
  let totalPromptTokens = 0;
  let totalCompletionTokens = 0;
  let totalTokens = 0;
  let llmCalls = 0;

  for (let step = 1; step <= boundedMaxSteps; step++) {
    const response = await callModel(
      params.llm,
      messages,
      toolDefinitions,
      params.maxTokens,
    );

    llmCalls++;
    totalPromptTokens += response.usage.promptTokens;
    totalCompletionTokens += response.usage.completionTokens;
    const stepTokens = computeTotalTokens(response.usage);
    totalTokens += stepTokens;

    traceEvents.push({
      type: 'llm_call',
      step,
      promptTokens: response.usage.promptTokens,
      completionTokens: response.usage.completionTokens,
      totalTokens: stepTokens,
      model: response.model,
    });

    const toolCalls = response.message.tool_calls;
    if (toolCalls && toolCalls.length > 0) {
      messages.push({
        role: 'assistant',
        content: response.message.content,
        tool_calls: toolCalls,
      });

      for (const toolCall of toolCalls) {
        const { result, event, approvalEvent } = await executeSingleToolCall(
          params.tools,
          toolCall,
          step,
          params.approval,
        );
        if (approvalEvent) {
          traceEvents.push(approvalEvent);
        }
        traceEvents.push(event);

        messages.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          content: JSON.stringify(result),
        });
      }
      // Re-loop to send tool observations back to the LLM
      continue;
    }

    // No tool calls: final text answer
    const rawReply = response.message.content ?? '';
    const isEmpty = rawReply.trim().length === 0;
    const finalReply = isEmpty ? FALLBACK_EMPTY_REPLY_MESSAGE : rawReply;
    const stopReason = isEmpty ? 'empty_reply' : 'answered';

    messages.push({
      role: 'assistant',
      content: finalReply,
    });

    traceEvents.push({
      type: 'stop',
      step,
      reason: stopReason,
      totalLlmCalls: llmCalls,
      totalTokens,
    });

    return {
      reply: finalReply,
      stopReason,
      steps: step,
      llmCalls,
      usage: {
        promptTokens: totalPromptTokens,
        completionTokens: totalCompletionTokens,
        totalTokens,
      },
      trace: traceEvents,
      messages,
    };
  }

  // Max steps reached
  messages.push({
    role: 'assistant',
    content: FALLBACK_MAX_STEPS_MESSAGE,
  });

  traceEvents.push({
    type: 'stop',
    step: boundedMaxSteps,
    reason: 'max_steps',
    totalLlmCalls: llmCalls,
    totalTokens,
  });

  return {
    reply: FALLBACK_MAX_STEPS_MESSAGE,
    stopReason: 'max_steps',
    steps: boundedMaxSteps,
    llmCalls,
    usage: {
      promptTokens: totalPromptTokens,
      completionTokens: totalCompletionTokens,
      totalTokens,
    },
    trace: traceEvents,
    messages,
  };
}
