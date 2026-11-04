import type { ApprovalRequest } from '../ports/approval.js';
import type { TokenUsage, ToolDefinition } from '../ports/llm-client.js';
import type { TraceEvent } from '../agent/trace.js';

export interface ToolApprovalPreparation {
  readonly valid: boolean;
  readonly request?: ApprovalRequest;
  readonly errorResult?: Record<string, unknown>;
}

export interface Tool {
  readonly name: string;
  readonly description: string;
  readonly parameters: Record<string, unknown>;
  readonly requiresApproval?: boolean;
  prepareApproval?(args: unknown): Promise<ToolApprovalPreparation>;
  execute(args: unknown): Promise<Record<string, unknown>>;
  executeDetailed?(args: unknown): Promise<{
    result: Record<string, unknown>;
    nested?: {
      traceEvents: TraceEvent[];
      llmCalls: number;
      usage: TokenUsage;
    };
  }>;
  toDefinition(): ToolDefinition;
}
