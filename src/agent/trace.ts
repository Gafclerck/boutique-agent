import type { TokenUsage } from '../ports/llm-client.js';

export interface BaseTraceEvent {
  readonly agent: string;
  readonly nested?: boolean;
}

export interface LlmCallTraceEvent extends BaseTraceEvent {
  readonly type: 'llm_call';
  readonly step: number;
  readonly promptTokens: number;
  readonly completionTokens: number;
  readonly totalTokens: number;
  readonly model: string;
}

export interface ToolCallTraceEvent extends BaseTraceEvent {
  readonly type: 'tool_call';
  readonly step: number;
  readonly name: string;
  readonly arguments: unknown;
  readonly result: Record<string, unknown>;
  readonly durationMs: number;
}

export interface ApprovalTraceEvent extends BaseTraceEvent {
  readonly type: 'approval';
  readonly step: number;
  readonly tool: string;
  readonly decision: boolean;
  readonly reason?: string;
}

export interface OrderSubmittedTraceEvent extends BaseTraceEvent {
  readonly type: 'order_submitted';
  readonly step: number;
  readonly numero: number;
  readonly cancelledNumbers: readonly number[];
}

export interface EvaluationTraceEvent extends BaseTraceEvent {
  readonly type: 'evaluation';
  readonly step: number;
  readonly ok: boolean;
  readonly violations: readonly string[];
  readonly retryNumber: number;
}

export interface RetryTraceEvent extends BaseTraceEvent {
  readonly type: 'retry';
  readonly step: number;
  readonly retryNumber: number;
}

export interface StopTraceEvent extends BaseTraceEvent {
  readonly type: 'stop';
  readonly step: number;
  readonly reason:
    | 'answered'
    | 'max_steps'
    | 'empty_reply'
    | 'evaluation_failed'
    | 'budget_exceeded';
  readonly totalLlmCalls: number;
  readonly totalTokens: number;
}

export interface JudgeCallTraceEvent extends BaseTraceEvent {
  readonly type: 'judge_call';
  readonly step?: number;
  readonly model: string;
  readonly tokens: number;
  readonly verdict: 'ok' | 'pas_encore';
  readonly durationMs: number;
  readonly duration?: number;
  readonly usage?: TokenUsage;
}

export interface JudgeErrorTraceEvent extends BaseTraceEvent {
  readonly type: 'judge_error';
  readonly step?: number;
  readonly reason: string;
}

export type TraceEvent =
  | LlmCallTraceEvent
  | ToolCallTraceEvent
  | ApprovalTraceEvent
  | OrderSubmittedTraceEvent
  | EvaluationTraceEvent
  | RetryTraceEvent
  | StopTraceEvent
  | JudgeCallTraceEvent
  | JudgeErrorTraceEvent;

/**
 * Formats trace events into a readable console string.
 * Renders one line per tool call, approval decision, LLM call, evaluation, retry, and final stop.
 * Displays the agent role and indents nested events.
 */
export function formatTrace(events: readonly TraceEvent[]): string {
  const lines: string[] = [];

  for (const event of events) {
    const indent = event.nested ? '  ' : '';
    const prefix = `${indent}[${event.agent}] `;

    switch (event.type) {
      case 'llm_call':
        lines.push(
          `${prefix}[Étape ${event.step}] Appel LLM (${event.model}) : ${event.promptTokens} prompt + ${event.completionTokens} compl = ${event.totalTokens} tokens`,
        );
        break;

      case 'approval': {
        const decisionText = event.decision ? 'APPROUVÉE' : 'REFUSÉE';
        const reasonText = event.reason ? ` (${event.reason})` : '';
        lines.push(
          `${prefix}[Étape ${event.step}] Approbation (${event.tool}) : ${decisionText}${reasonText}`,
        );
        break;
      }

      case 'order_submitted': {
        const cancelledInfo =
          event.cancelledNumbers.length > 0
            ? ` (anciennes commandes annulées : ${event.cancelledNumbers.join(', ')})`
            : '';
        lines.push(
          `${prefix}[Étape ${event.step}] Commande #${event.numero} soumise pour validation${cancelledInfo}`,
        );
        break;
      }

      case 'tool_call': {
        const rawArgs =
          typeof event.arguments === 'string'
            ? event.arguments
            : JSON.stringify(event.arguments);
        const rawResult = JSON.stringify(event.result);
        const truncatedResult =
          rawResult.length > 200 ? `${rawResult.slice(0, 197)}...` : rawResult;

        lines.push(
          `${prefix}[Étape ${event.step}] ${event.name}(${rawArgs}) -> ${truncatedResult} (${event.durationMs}ms)`,
        );
        break;
      }

      case 'evaluation': {
        const status = event.ok
          ? 'CONFORME'
          : `NON CONFORME (${event.violations.join(', ')})`;
        lines.push(
          `${prefix}[Étape ${event.step}] Évaluation qualité (reprise ${event.retryNumber}) : ${status}`,
        );
        break;
      }

      case 'retry':
        lines.push(
          `${prefix}[Étape ${event.step}] Reprise après critique qualité (reprise ${event.retryNumber})`,
        );
        break;

      case 'stop':
        lines.push(
          `${prefix}[Fin] Arrêt : ${event.reason} | Appels LLM : ${event.totalLlmCalls} | Tokens cumulés : ${event.totalTokens}`,
        );
        break;

      case 'judge_call':
        lines.push(
          `${prefix}[Juge] Appel LLM (${event.model}) : ${event.tokens} tokens, verdict = ${event.verdict} (${event.durationMs}ms)`,
        );
        break;

      case 'judge_error':
        lines.push(`${prefix}[Juge] Échec ouvert (erreur ignorée) : ${event.reason}`);
        break;
    }
  }

  return lines.join('\n');
}
