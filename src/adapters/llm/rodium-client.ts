import {
  type ChatRequest,
  type ChatResponse,
  type LlmClient,
  LlmError,
} from '../../ports/llm-client.js';

export interface RodiumClientOptions {
  readonly apiKey?: string;
  readonly baseUrl?: string;
  readonly model?: string;
  readonly maxTokens?: number;
  readonly temperature?: number;
  readonly fetchFn?: typeof fetch;
  readonly retryDelayMs?: number;
}

export class RodiumClient implements LlmClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly model: string;
  private readonly defaultMaxTokens: number;
  private readonly defaultTemperature: number;
  private readonly fetchFn: typeof fetch;
  private readonly retryDelayMs: number;

  constructor(options: RodiumClientOptions = {}) {
    const apiKey =
      options.apiKey ??
      process.env.RODIUM_API_KEY ??
      process.env.RODIUMAI_API_KEY;

    if (!apiKey) {
      throw new Error(
        'RODIUM_API_KEY is required in environment variables or constructor options.',
      );
    }

    const model =
      options.model ??
      process.env.RODIUM_MODEL ??
      process.env.RODIUMAI_MODEL;

    if (!model) {
      throw new Error(
        'RODIUM_MODEL is required in environment variables or constructor options.',
      );
    }

    this.apiKey = apiKey;
    this.model = model;

    this.baseUrl = (
      options.baseUrl ??
      process.env.RODIUM_BASE_URL ??
      process.env.RODIUMAI_BASE_URL ??
      'https://api.rodiumai.io/v1'
    ).replace(/\/+$/, '');

    this.defaultMaxTokens =
      options.maxTokens ??
      (process.env.MAX_TOKENS ? Number.parseInt(process.env.MAX_TOKENS, 10) : 600);

    this.defaultTemperature =
      options.temperature ??
      (process.env.TEMPERATURE ? Number.parseFloat(process.env.TEMPERATURE) : 0);

    this.fetchFn = options.fetchFn ?? globalThis.fetch;
    this.retryDelayMs = options.retryDelayMs ?? 500;
  }

  public async chat(request: ChatRequest): Promise<ChatResponse> {
    const url = `${this.baseUrl}/chat/completions`;
    const maxTokens = request.maxTokens ?? this.defaultMaxTokens;
    const temperature = request.temperature ?? this.defaultTemperature;

    const payload: Record<string, unknown> = {
      model: this.model,
      messages: request.messages.map((m) => {
        const msg: Record<string, unknown> = {
          role: m.role,
          content: m.content ?? null,
        };
        if (m.tool_calls && m.tool_calls.length > 0) {
          msg.tool_calls = m.tool_calls;
        }
        if (m.tool_call_id) {
          msg.tool_call_id = m.tool_call_id;
        }
        return msg;
      }),
      max_tokens: maxTokens,
      temperature,
    };

    if (request.tools && request.tools.length > 0) {
      payload.tools = request.tools;
      payload.tool_choice = request.toolChoice ?? 'auto';
    }

    let response: Response | undefined;
    let lastNetworkError: unknown;

    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        response = await this.fetchFn(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${this.apiKey}`,
          },
          body: JSON.stringify(payload),
        });

        // Client errors (4xx): do NOT retry
        if (response.status >= 400 && response.status < 500) {
          break;
        }

        // Server errors (5xx): retry if attempts remain
        if (response.status >= 500) {
          if (attempt < 2) {
            if (this.retryDelayMs > 0) {
              await new Promise((resolve) =>
                setTimeout(resolve, this.retryDelayMs * (attempt + 1)),
              );
            }
            continue;
          }
          break;
        }

        // Success / other status
        break;
      } catch (err) {
        lastNetworkError = err;
        response = undefined;
        if (attempt < 2) {
          if (this.retryDelayMs > 0) {
            await new Promise((resolve) =>
              setTimeout(resolve, this.retryDelayMs * (attempt + 1)),
            );
          }
        }
      }
    }

    if (!response) {
      const errorMessage =
        lastNetworkError instanceof Error
          ? lastNetworkError.message
          : 'Network request failed';
      throw new LlmError(0, errorMessage);
    }

    if (!response.ok) {
      let apiMessage = `HTTP ${response.status} ${response.statusText}`;
      try {
        const errorJson = (await response.json()) as {
          error?: { message?: string } | string;
          message?: string;
        };
        if (typeof errorJson.error === 'object' && errorJson.error?.message) {
          apiMessage = errorJson.error.message;
        } else if (typeof errorJson.error === 'string') {
          apiMessage = errorJson.error;
        } else if (errorJson.message) {
          apiMessage = errorJson.message;
        }
      } catch {
        // Fallback to HTTP status text if body is not valid JSON
      }
      throw new LlmError(response.status, apiMessage);
    }

    const data = (await response.json()) as {
      model?: string;
      choices?: Array<{
        message?: {
          role?: string;
          content?: string | null;
          tool_calls?: Array<{
            id: string;
            type: 'function';
            function: {
              name: string;
              arguments: string;
            };
          }>;
        };
      }>;
      usage?: {
        prompt_tokens?: number;
        completion_tokens?: number;
        total_tokens?: number;
      };
    };

    const firstChoice = data.choices?.[0]?.message;
    if (!firstChoice) {
      throw new LlmError(500, 'Invalid API response: no choices returned');
    }

    const promptTokens = data.usage?.prompt_tokens ?? 0;
    const completionTokens = data.usage?.completion_tokens ?? 0;
    const totalTokens = data.usage?.total_tokens ?? promptTokens + completionTokens;

    return {
      message: {
        role: 'assistant',
        content: firstChoice.content ?? null,
        tool_calls: firstChoice.tool_calls,
      },
      usage: {
        promptTokens,
        completionTokens,
        totalTokens,
      },
      model: data.model ?? this.model,
    };
  }
}
