import { INITIAL_PRODUCTS, type Product } from '../domain/catalogue.js';
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
import {
  buildCritiqueMessage,
  collectHistoryGrounding,
  hasPriorCatalogueLookup,
  type EvaluationInput,
  type Evaluator,
  type HistoryGrounding,
} from './evaluation/index.js';
import { evaluateToolGuard } from './guards.js';
import { BudgetExceededError } from './budget.js';
import type {
  ApprovalTraceEvent,
  ToolCallTraceEvent,
  TraceEvent,
} from './trace.js';

export {
  hasPriorCatalogueLookup,
  type Evaluator,
} from './evaluation/index.js';

export interface RunAgentParams {
  readonly llm: LlmClient;
  readonly tools: ToolRegistry;
  readonly instructions: string;
  readonly history?: readonly ChatMessage[];
  readonly userMessage: string;
  readonly maxSteps?: number;
  readonly maxTokens?: number;
  readonly approval?: ApprovalPort;
  readonly evaluate?: Evaluator;
  readonly maxEvaluationRetries?: number;
  readonly catalogue?: readonly Product[];
  readonly role?: string;
  readonly historyGrounding?: HistoryGrounding;
  readonly priorToolNames?: ReadonlySet<string>;
}

export interface AgentRunResult {
  readonly reply: string;
  readonly stopReason:
    | 'answered'
    | 'max_steps'
    | 'empty_reply'
    | 'evaluation_failed'
    | 'budget_exceeded';
  readonly steps: number;
  readonly llmCalls: number;
  readonly usage: TokenUsage;
  readonly trace: readonly TraceEvent[];
  readonly messages: readonly ChatMessage[];
  readonly evaluationRetries: number;
  readonly lastViolations?: readonly string[];
  readonly durationMs: number;
  readonly toolNames: string[];
}

export const FALLBACK_MAX_STEPS_MESSAGE =
  "Je vous prie de m'excuser, je n'ai pas pu finaliser votre demande à temps. Pouvez-vous reformuler ou me préciser votre besoin ?";

export const FALLBACK_EMPTY_REPLY_MESSAGE =
  "Je vous prie de m'excuser, je n'ai pas pu formuler de réponse. Pouvez-vous reformuler ou préciser votre demande ?";

export const EVALUATION_FALLBACK_MESSAGE =
  "Je ne suis pas en mesure de confirmer cette information pour le moment. Pouvez-vous reformuler votre demande ?";

function computeTotalTokens(usage: TokenUsage): number {
  return usage.totalTokens ?? usage.promptTokens + usage.completionTokens;
}

export async function callModel(
  llm: LlmClient,
  messages: readonly ChatMessage[],
  tools: readonly ToolDefinition[],
  maxTokens?: number,
  role?: string,
): Promise<ChatResponse> {
  return llm.chat({
    messages,
    tools,
    toolChoice: 'auto',
    maxTokens,
    role,
  });
}

export async function executeSingleToolCall(
  tools: ToolRegistry,
  toolCall: ToolCall,
  step: number,
  approval?: ApprovalPort,
  role: string = 'agent',
): Promise<{
  result: Record<string, unknown>;
  event: ToolCallTraceEvent;
  approvalEvent?: ApprovalTraceEvent;
  nested?: {
    traceEvents: TraceEvent[];
    llmCalls: number;
    usage: TokenUsage;
    toolNames?: string[];
  };
}> {
  const startTime = Date.now();
  let callArguments: unknown = toolCall.function.arguments;
  let result: Record<string, unknown>;
  let approvalEvent: ApprovalTraceEvent | undefined;
  let nested:
    | {
        traceEvents: TraceEvent[];
        llmCalls: number;
        usage: TokenUsage;
        toolNames?: string[];
      }
    | undefined;

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
      const guard = await evaluateToolGuard(tool, parsedArgs, step, approval, role);
      approvalEvent = guard.approvalEvent;

      if (!guard.canExecute) {
        result = guard.directResult ?? { erreur: 'action non autorisée' };
      } else {
        if (typeof tool.executeDetailed === 'function') {
          try {
            const detailed = await tool.executeDetailed(parsedArgs);
            result = detailed.result;
            nested = detailed.nested;
          } catch {
            result = {
              erreur: "erreur interne lors de l'exécution de l'outil",
            };
          }
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
      agent: role,
      name: toolCall.function.name,
      arguments: callArguments,
      result,
      durationMs,
    },
    approvalEvent,
    nested,
  };
}

export async function runAgent(params: RunAgentParams): Promise<AgentRunResult> {
  const runStartTime = Date.now();
  const role = params.role ?? 'agent';
  const boundedMaxSteps = Math.min(Math.max(params.maxSteps ?? 8, 1), 10);
  const maxEvaluationRetries = Math.min(
    Math.max(params.maxEvaluationRetries ?? 2, 0),
    3,
  );
  const catalogue = params.catalogue ?? INITIAL_PRODUCTS;
  const toolDefinitions = params.tools.getDefinitions();
  const priorCatalogueLookup =
    params.priorToolNames !== undefined
      ? params.priorToolNames.has('chercher_produits')
      : hasPriorCatalogueLookup(params.history);

  const messages: ChatMessage[] = [
    { role: 'system', content: params.instructions },
    ...(params.history ?? []),
    { role: 'user', content: params.userMessage },
  ];

  // Track retry messages (rejected drafts and quality critiques) to exclude them from result.messages
  const retryMessages = new Set<ChatMessage>();

  const traceEvents: TraceEvent[] = [];
  const toolNames: string[] = [];
  let totalPromptTokens = 0;
  let totalCompletionTokens = 0;
  let totalTokens = 0;
  let llmCalls = 0;
  let evaluationRetries = 0;
  let lastViolations: string[] | undefined;
  const historyGrounding =
    params.historyGrounding ?? collectHistoryGrounding(params.history);

  let step = 1;
  try {
    for (; step <= boundedMaxSteps; step++) {
    const response = await callModel(
      params.llm,
      messages,
      toolDefinitions,
      params.maxTokens,
      role,
    );

    llmCalls++;
    totalPromptTokens += response.usage.promptTokens;
    totalCompletionTokens += response.usage.completionTokens;
    const stepTokens = computeTotalTokens(response.usage);
    totalTokens += stepTokens;

    traceEvents.push({
      type: 'llm_call',
      step,
      agent: role,
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
        const { result, event, approvalEvent, nested } = await executeSingleToolCall(
          params.tools,
          toolCall,
          step,
          params.approval,
          role,
        );
        if (approvalEvent) {
          traceEvents.push(approvalEvent);
        }
        traceEvents.push(event);

        toolNames.push(toolCall.function.name);
        if (nested?.toolNames) {
          toolNames.push(...nested.toolNames);
        }

        if (nested) {
          if (nested.traceEvents && nested.traceEvents.length > 0) {
            const taggedNestedEvents = nested.traceEvents.map((e) => ({
              ...e,
              nested: true,
            }));
            traceEvents.push(...taggedNestedEvents);
          }
          if (nested.llmCalls) {
            llmCalls += nested.llmCalls;
          }
          if (nested.usage) {
            totalPromptTokens += nested.usage.promptTokens;
            totalCompletionTokens += nested.usage.completionTokens;
            totalTokens += computeTotalTokens(nested.usage);
          }
        }

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

    if (isEmpty) {
      // Empty reply fallback: no evaluation
      const finalReply = FALLBACK_EMPTY_REPLY_MESSAGE;
      const stopReason = 'empty_reply';

      const finalMessages = messages.filter((m) => !retryMessages.has(m));
      finalMessages.push({
        role: 'assistant',
        content: finalReply,
      });

      traceEvents.push({
        type: 'stop',
        step,
        agent: role,
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
        messages: finalMessages,
        evaluationRetries,
        lastViolations,
        durationMs: Date.now() - runStartTime,
        toolNames,
      };
    }

    // Non-empty reply: evaluate if evaluator provided
    if (params.evaluate) {
      const evalInput: EvaluationInput = {
        userMessage: params.userMessage,
        reply: rawReply,
        trace: traceEvents,
        catalogue,
        hasPriorCatalogueLookup: priorCatalogueLookup,
        historyGrounding,
      };

      const verdict = await params.evaluate(evalInput);

      if (verdict.llmCalls) {
        llmCalls += verdict.llmCalls;
      }
      if (verdict.usage) {
        totalPromptTokens += verdict.usage.promptTokens;
        totalCompletionTokens += verdict.usage.completionTokens;
        totalTokens += computeTotalTokens(verdict.usage);
      }
      if (verdict.traceEvents && verdict.traceEvents.length > 0) {
        traceEvents.push(...verdict.traceEvents);
      }

      traceEvents.push({
        type: 'evaluation',
        step,
        agent: role,
        ok: verdict.ok,
        violations: verdict.violations.map((v) => v.rule),
        retryNumber: evaluationRetries,
      });

      if (!verdict.ok) {
        lastViolations = verdict.violations.map((v) => v.rule);

        if (evaluationRetries < maxEvaluationRetries) {
          evaluationRetries++;
          traceEvents.push({
            type: 'retry',
            step,
            agent: role,
            retryNumber: evaluationRetries,
          });

          const draftMessage: ChatMessage = {
            role: 'assistant',
            content: rawReply,
          };
          const critiqueMessage: ChatMessage = {
            role: 'user',
            content: buildCritiqueMessage(verdict.violations),
          };

          retryMessages.add(draftMessage);
          retryMessages.add(critiqueMessage);

          messages.push(draftMessage, critiqueMessage);
          continue;
        }

        // No more retries: fallback
        const finalReply = EVALUATION_FALLBACK_MESSAGE;
        const stopReason = 'evaluation_failed';

        const finalMessages = messages.filter((m) => !retryMessages.has(m));
        finalMessages.push({
          role: 'assistant',
          content: finalReply,
        });

        traceEvents.push({
          type: 'stop',
          step,
          agent: role,
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
          messages: finalMessages,
          evaluationRetries,
          lastViolations,
          durationMs: Date.now() - runStartTime,
          toolNames,
        };
      }
    }

    // Verdict ok or no evaluate provided: accepted
    const finalReply = rawReply;
    const stopReason = 'answered';

    const finalMessages = messages.filter((m) => !retryMessages.has(m));
    finalMessages.push({
      role: 'assistant',
      content: finalReply,
    });

    traceEvents.push({
      type: 'stop',
      step,
      agent: role,
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
      messages: finalMessages,
      evaluationRetries,
      lastViolations,
      durationMs: Date.now() - runStartTime,
      toolNames,
    };
  }

  // Max steps reached
  const finalReply = FALLBACK_MAX_STEPS_MESSAGE;
  const finalMessages = messages.filter((m) => !retryMessages.has(m));
  finalMessages.push({
    role: 'assistant',
    content: finalReply,
  });

  traceEvents.push({
    type: 'stop',
    step: boundedMaxSteps,
    agent: role,
    reason: 'max_steps',
    totalLlmCalls: llmCalls,
    totalTokens,
  });

  return {
    reply: finalReply,
    stopReason: 'max_steps',
    steps: boundedMaxSteps,
    llmCalls,
    usage: {
      promptTokens: totalPromptTokens,
      completionTokens: totalCompletionTokens,
      totalTokens,
    },
    trace: traceEvents,
    messages: finalMessages,
    evaluationRetries,
    lastViolations,
    durationMs: Date.now() - runStartTime,
    toolNames,
  };
} catch (err) {
  if (err instanceof BudgetExceededError) {
    const finalReply = EVALUATION_FALLBACK_MESSAGE;
    const finalMessages = messages.filter((m) => !retryMessages.has(m));
    finalMessages.push({
      role: 'assistant',
      content: finalReply,
    });

    traceEvents.push({
      type: 'stop',
      step: Math.min(step, boundedMaxSteps),
      agent: role,
      reason: 'budget_exceeded',
      totalLlmCalls: llmCalls,
      totalTokens,
    });

    return {
      reply: finalReply,
      stopReason: 'budget_exceeded',
      steps: Math.min(step, boundedMaxSteps),
      llmCalls,
      usage: {
        promptTokens: totalPromptTokens,
        completionTokens: totalCompletionTokens,
        totalTokens,
      },
      trace: traceEvents,
      messages: finalMessages,
      evaluationRetries,
      lastViolations,
      durationMs: Date.now() - runStartTime,
      toolNames,
    };
  }

  throw err;
}
}
