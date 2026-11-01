import {
  type ChatRequest,
  type ChatResponse,
  type LlmClient,
} from '../../ports/llm-client.js';

export class FakeLlm implements LlmClient {
  public readonly requests: ChatRequest[] = [];
  private readonly responses: ChatResponse[];

  constructor(responses: ChatResponse[] = []) {
    this.responses = [...responses];
  }

  public addResponse(response: ChatResponse): void {
    this.responses.push(response);
  }

  public async chat(request: ChatRequest): Promise<ChatResponse> {
    this.requests.push(request);

    const nextResponse = this.responses.shift();
    if (!nextResponse) {
      throw new Error('FakeLlm: No more scripted responses available');
    }

    return nextResponse;
  }
}
