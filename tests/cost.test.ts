import { describe, expect, it } from 'vitest';
import { estimateCostRodi } from '../src/metrics/cost.js';
import { getModelPrice, MODEL_PRICES } from '../src/metrics/model-prices.js';

describe('TACHE C : Mesure du coût en RODI', () => {
  it('calcule exactement le coût en RODI sur un exemple connu', () => {
    const price = getModelPrice('anthropic/claude-haiku-4-5-20251001');
    expect(price).toBeDefined();
    expect(price).toEqual({
      inputPerMillion: 753.5,
      outputPerMillion: 3767.3,
    });

    // 10 000 tokens prompt, 2 000 tokens completion
    const usage = {
      promptTokens: 10_000,
      completionTokens: 2_000,
      totalTokens: 12_000,
    };

    const cost = estimateCostRodi(usage, price!);
    // input: 10_000 * 753.5 / 1_000_000 = 7.535
    expect(cost.inputRodi).toBeCloseTo(7.535, 6);
    // output: 2_000 * 3767.3 / 1_000_000 = 7.5346
    expect(cost.outputRodi).toBeCloseTo(7.5346, 6);
    // total: 7.535 + 7.5346 = 15.0696
    expect(cost.totalRodi).toBeCloseTo(15.0696, 6);
  });

  it('calcule le coût pour google/gemini-2.5-flash et anthropic/claude-sonnet-4-6', () => {
    const geminiPrice = getModelPrice('google/gemini-2.5-flash');
    expect(geminiPrice).toEqual({
      inputPerMillion: 226.0,
      outputPerMillion: 1882.9,
    });

    const sonnetPrice = getModelPrice('anthropic/claude-sonnet-4-6');
    expect(sonnetPrice).toEqual({
      inputPerMillion: 2259.4,
      outputPerMillion: 11296.9,
    });
  });

  it('renvoie undefined si le modèle est inconnu (coût non disponible, jamais deviné)', () => {
    const unknownPrice = getModelPrice('inconnu/modele-inexistant');
    expect(unknownPrice).toBeUndefined();
  });
});
