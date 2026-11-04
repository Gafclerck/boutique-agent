import type { EvaluationInput, Violation } from '../types.js';
import { normalizeText } from '../utils.js';

export const COMMANDE_EN_ATTENTE_CRITIQUE =
  "Contrôle qualité : la commande est seulement transmise à la boutique pour validation. Ne dis pas qu'elle est confirmée ; indique qu'elle est en attente de validation et que le client sera prévenu.";

/**
 * Rule: commandeEnAttente
 * If the turn contains an 'order_submitted' trace event, and the normalized reply
 * contains 'confirmee', 'enregistree' or 'validee' WITHOUT containing 'attente',
 * the rule is violated.
 */
export function evaluateCommandeEnAttente(
  input: EvaluationInput,
): Violation | null {
  const hasOrderSubmitted = input.trace.some(
    (event) => event.type === 'order_submitted',
  );

  if (!hasOrderSubmitted) {
    return null;
  }

  const normalized = normalizeText(input.reply);

  const containsForbidden =
    normalized.includes('confirmee') ||
    normalized.includes('enregistree') ||
    normalized.includes('validee');

  const containsAttente = normalized.includes('attente');

  if (containsForbidden && !containsAttente) {
    return {
      rule: 'commandeEnAttente',
      critique: COMMANDE_EN_ATTENTE_CRITIQUE,
    };
  }

  return null;
}
