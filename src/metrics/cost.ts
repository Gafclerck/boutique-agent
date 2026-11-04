import type { TokenUsage } from '../ports/llm-client.js';
import type { ModelPrice } from './model-prices.js';

export interface CostEstimate {
  readonly inputRodi: number;
  readonly outputRodi: number;
  readonly totalRodi: number;
}

/**
 * Estime le coût en RODI d'une consommation de tokens selon le tarif du modèle.
 */
export function estimateCostRodi(
  usage: TokenUsage,
  price: ModelPrice,
): CostEstimate {
  const inputRodi = (usage.promptTokens * price.inputPerMillion) / 1_000_000;
  const outputRodi = (usage.completionTokens * price.outputPerMillion) / 1_000_000;
  const totalRodi = inputRodi + outputRodi;

  return {
    inputRodi,
    outputRodi,
    totalRodi,
  };
}
