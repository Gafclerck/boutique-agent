export type Role = 'system' | 'user' | 'assistant' | 'tool';

export interface ToolCall {
  readonly id: string;
  readonly type: 'function';
  readonly function: {
    readonly name: string;
    readonly arguments: string;
  };
}

export interface ChatMessage {
  readonly role: Role;
  readonly content: string | null;
  readonly tool_calls?: readonly ToolCall[];
  readonly tool_call_id?: string;
}

export interface ToolDefinition {
  readonly type: 'function';
  readonly function: {
    readonly name: string;
    readonly description: string;
    readonly parameters: Record<string, unknown>;
  };
}

export interface TokenUsage {
  readonly promptTokens: number;
  readonly completionTokens: number;
  readonly totalTokens?: number;
}

export interface AssistantMessage {
  readonly role: 'assistant';
  readonly content: string | null;
  readonly tool_calls?: readonly ToolCall[];
}

export interface ChatResponse {
  readonly message: AssistantMessage;
  readonly usage: TokenUsage;
  readonly model: string;
}

export interface ChatRequest {
  readonly messages: readonly ChatMessage[];
  readonly tools?: readonly ToolDefinition[];
  readonly toolChoice?: 'auto' | 'none' | 'required';
  readonly maxTokens?: number;
  readonly temperature?: number;
  readonly role?: string;
}

export type LlmRequest = ChatRequest;

export interface LlmClient {
  chat(request: ChatRequest): Promise<ChatResponse>;
}

export class LlmError extends Error {
  public readonly status: number;
  public readonly apiMessage: string;

  constructor(status: number, apiMessage: string) {
    super(`LLM API Error (${status}): ${apiMessage}`);
    this.name = 'LlmError';
    this.status = status;
    this.apiMessage = apiMessage;
  }
}
