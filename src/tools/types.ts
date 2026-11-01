import type { ToolDefinition } from '../ports/llm-client.js';

export interface Tool {
  readonly name: string;
  readonly description: string;
  readonly parameters: Record<string, unknown>;
  execute(args: unknown): Promise<Record<string, unknown>>;
  toDefinition(): ToolDefinition;
}
