export interface LlmCallTraceEvent {
  readonly type: 'llm_call';
  readonly step: number;
  readonly promptTokens: number;
  readonly completionTokens: number;
  readonly totalTokens: number;
  readonly model: string;
}

export interface ToolCallTraceEvent {
  readonly type: 'tool_call';
  readonly step: number;
  readonly name: string;
  readonly arguments: unknown;
  readonly result: Record<string, unknown>;
  readonly durationMs: number;
}

export interface ApprovalTraceEvent {
  readonly type: 'approval';
  readonly step: number;
  readonly tool: string;
  readonly decision: boolean;
  readonly reason?: string;
}

export interface StopTraceEvent {
  readonly type: 'stop';
  readonly step: number;
  readonly reason: 'answered' | 'max_steps' | 'empty_reply';
  readonly totalLlmCalls: number;
  readonly totalTokens: number;
}

export type TraceEvent =
  | LlmCallTraceEvent
  | ToolCallTraceEvent
  | ApprovalTraceEvent
  | StopTraceEvent;

/**
 * Formats trace events into a readable console string.
 * Renders one line per tool call, approval decision, LLM call, and final stop.
 */
export function formatTrace(events: readonly TraceEvent[]): string {
  const lines: string[] = [];

  for (const event of events) {
    switch (event.type) {
      case 'llm_call':
        lines.push(
          `[Étape ${event.step}] Appel LLM (${event.model}) : ${event.promptTokens} prompt + ${event.completionTokens} compl = ${event.totalTokens} tokens`,
        );
        break;

      case 'approval': {
        const decisionText = event.decision ? 'APPROUVÉE' : 'REFUSÉE';
        const reasonText = event.reason ? ` (${event.reason})` : '';
        lines.push(
          `[Étape ${event.step}] Approbation (${event.tool}) : ${decisionText}${reasonText}`,
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
          `[Étape ${event.step}] ${event.name}(${rawArgs}) -> ${truncatedResult} (${event.durationMs}ms)`,
        );
        break;
      }

      case 'stop':
        lines.push(
          `[Fin] Arrêt : ${event.reason} | Appels LLM : ${event.totalLlmCalls} | Tokens cumulés : ${event.totalTokens}`,
        );
        break;
    }
  }

  return lines.join('\n');
}
