/**
 * Tarifs RODI par million de tokens pour les modèles supportés.
 * Source : Documentation Rodium AI (GET /v1/pricing)
 * Date : Novembre 2026
 */

export interface ModelPrice {
  readonly inputPerMillion: number;
  readonly outputPerMillion: number;
}

export const MODEL_PRICES: Record<string, ModelPrice> = {
  'anthropic/claude-haiku-4-5-20251001': {
    inputPerMillion: 753.5,
    outputPerMillion: 3767.3,
  },
  'anthropic/claude-sonnet-4-6': {
    inputPerMillion: 2259.4,
    outputPerMillion: 11296.9,
  },
  'google/gemini-2.5-flash': {
    inputPerMillion: 226.0,
    outputPerMillion: 1882.9,
  },
};

export function getModelPrice(modelId: string): ModelPrice | undefined {
  return MODEL_PRICES[modelId];
}
