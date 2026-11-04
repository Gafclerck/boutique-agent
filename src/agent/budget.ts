import type { ChatRequest, ChatResponse, LlmClient } from '../ports/llm-client.js';

export class BudgetExceededError extends Error {
  public readonly maxCalls: number;
  public readonly currentCalls: number;

  constructor(maxCalls: number, currentCalls: number) {
    super(`Budget d'appels LLM dépassé : ${currentCalls} / ${maxCalls} appels autorisés`);
    this.name = 'BudgetExceededError';
    this.maxCalls = maxCalls;
    this.currentCalls = currentCalls;
  }
}

export interface CallBudget {
  readonly max: number;
  count: number;
}

/**
 * Crée un compteur de budget d'appels LLM partagé pour un tour.
 */
export function createCallBudget(max: number): CallBudget {
  return {
    max,
    count: 0,
  };
}

/**
 * Décore un LlmClient avec un budget d'appels : chaque chat() incrémente
 * le compteur partagé et lève BudgetExceededError dès que max est dépassé.
 */
export function withCallBudget(llm: LlmClient, budget: CallBudget): LlmClient {
  return {
    async chat(request: ChatRequest): Promise<ChatResponse> {
      budget.count++;
      if (budget.count > budget.max) {
        throw new BudgetExceededError(budget.max, budget.count);
      }
      return llm.chat(request);
    },
  };
}
