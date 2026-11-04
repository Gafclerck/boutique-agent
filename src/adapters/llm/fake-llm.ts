import {
  type ChatRequest,
  type ChatResponse,
  type LlmClient,
} from '../../ports/llm-client.js';

export class FakeLlm implements LlmClient {
  public readonly requests: ChatRequest[] = [];
  private readonly responses: ChatResponse[];
  private readonly roleResponses?: Record<string, ChatResponse[]>;

  constructor(responses: ChatResponse[] | Record<string, ChatResponse[]> = []) {
    if (Array.isArray(responses)) {
      this.responses = [...responses];
    } else {
      this.responses = [];
      this.roleResponses = {};
      for (const [role, list] of Object.entries(responses)) {
        this.roleResponses[role] = [...list];
      }
    }
  }

  public addResponse(response: ChatResponse, role?: string): void {
    if (this.roleResponses) {
      const targetRole = role ?? 'agent';
      if (!this.roleResponses[targetRole]) {
        this.roleResponses[targetRole] = [];
      }
      this.roleResponses[targetRole].push(response);
    } else {
      this.responses.push(response);
    }
  }

  public async chat(request: ChatRequest): Promise<ChatResponse> {
    this.requests.push(request);

    if (this.roleResponses) {
      const role = request.role ?? 'agent';
      const list = this.roleResponses[role];
      if (!list || list.length === 0) {
        throw new Error(`FakeLlm: No more scripted responses for role "${role}"`);
      }
      return list.shift()!;
    }

    const nextResponse = this.responses.shift();
    if (!nextResponse) {
      throw new Error('FakeLlm: No more scripted responses available');
    }

    return nextResponse;
  }
}
