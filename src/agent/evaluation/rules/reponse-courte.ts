import type { EvaluationInput, Violation } from '../types.js';

export const MAX_REPLY_WORDS = 80;

/**
 * Counts words in a string: non-empty character sequences separated by
 * spaces, tabs, or newlines. Numbers count as words.
 */
export function countWords(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) {
    return 0;
  }
  return trimmed.split(/\s+/).filter(Boolean).length;
}

export function evaluateReponseCourte(input: EvaluationInput): Violation | null {
  const words = countWords(input.reply);
  if (words <= MAX_REPLY_WORDS) {
    return null;
  }

  return {
    rule: 'reponseCourte',
    critique: `Contrôle qualité : ta réponse fait ${words} mots, le maximum est ${MAX_REPLY_WORDS}. Reformule en gardant l'essentiel (produit, prix, total, prochaine étape), sans changer les chiffres issus des outils.`,
  };
}
