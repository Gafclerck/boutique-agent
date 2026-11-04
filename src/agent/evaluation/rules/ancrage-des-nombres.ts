import type { EvaluationInput, Violation } from '../types.js';
import {
  extractNumbersFromText,
  extractNumbersFromValue,
  extractSuccessfulToolResults,
} from '../utils.js';

export function evaluateAncrageDesNombres(
  input: EvaluationInput,
): Violation | null {
  const replyNumbers = extractNumbersFromText(input.reply);
  if (replyNumbers.length === 0) {
    return null;
  }

  // 1. Extract all numbers from successful tool results in the tour
  const successfulCalls = extractSuccessfulToolResults(input.trace);
  const toolNumbers: number[] = [];
  for (const call of successfulCalls) {
    toolNumbers.push(...extractNumbersFromValue(call.result));
  }

  // 2. Extract numbers from user message (quantities, budgets, etc.)
  const userNumbers = extractNumbersFromValue(input.userMessage);
  const historyNumbers = input.historyGrounding?.numbers ?? [];

  const numericMatches = (val: number, list: readonly number[]): boolean => {
    return list.some((item) => Math.abs(item - val) <= 0.005);
  };

  const unauthorized: string[] = [];

  for (const item of replyNumbers) {
    if (item.isMonetary) {
      // Monetary numbers: ONLY authorized if present in tool results
      const inTools = numericMatches(item.value, toolNumbers);
      const inHistory = numericMatches(item.value, historyNumbers);
      if (!inTools && !inHistory) {
        unauthorized.push(item.rawText);
      }
    } else {
      // Non-monetary numbers: authorized if present in tool results OR user message
      const inTools = numericMatches(item.value, toolNumbers);
      const inUser = numericMatches(item.value, userNumbers);
      const inHistory = numericMatches(item.value, historyNumbers);
      if (!inTools && !inUser && !inHistory) {
        unauthorized.push(item.rawText);
      }
    }
  }

  if (unauthorized.length === 0) {
    return null;
  }

  const uniqueUnauthorized = Array.from(new Set(unauthorized));

  return {
    rule: 'ancrageDesNombres',
    critique: `Contrôle qualité : les nombres ${uniqueUnauthorized.join(', ')} de ta réponse ne proviennent d'aucun résultat d'outil. Utilise uniquement les valeurs renvoyées par les outils (calculer_total pour un total, convertir_devise pour une conversion, verifier_stock pour un stock), puis reformule.`,
  };
}
