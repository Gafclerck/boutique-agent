import type { ToolCallTraceEvent } from '../../trace.js';
import type { EvaluationInput, Violation } from '../types.js';
import { extractSuccessfulToolResults } from '../utils.js';

const FCFA_AMOUNT_KEYS = new Set([
  'prix_fcfa',
  'prix_unitaire_fcfa',
  'sous_total_fcfa',
  'sous_total_articles_fcfa',
  'frais_fcfa',
  'frais_livraison_fcfa',
  'total_fcfa',
]);

function formatMontant(amount: number): string {
  const parts = amount.toString().split('.');
  parts[0] = parts[0]!.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return parts.join('.');
}

/**
 * Règle conversionSurMontantDeOutil :
 * Pour chaque appel de convertir_devise du tour, le montant_fcfa passé en argument
 * doit correspondre (tolérance 0,005) à un montant FCFA issu d'un résultat d'outil
 * du tour (prix_fcfa, prix_unitaire_fcfa, sous_total_fcfa, sous_total_articles_fcfa,
 * frais_fcfa, frais_livraison_fcfa, total_fcfa) OU à historyGrounding.
 */
export function evaluateConversionSurMontantDeOutil(
  input: EvaluationInput,
): Violation | null {
  // 1. Identifier les appels à convertir_devise dans la trace du tour
  const convertCalls = input.trace.filter(
    (e): e is ToolCallTraceEvent =>
      e.type === 'tool_call' && e.name === 'convertir_devise',
  );

  if (convertCalls.length === 0) {
    return null;
  }

  // 2. Extraire les montants FCFA autorisés des résultats d'outils du tour
  const successfulCalls = extractSuccessfulToolResults(input.trace);
  const authorizedAmounts: number[] = [];

  function collectFromValue(val: unknown): void {
    if (val === null || typeof val !== 'object') {
      return;
    }
    if (Array.isArray(val)) {
      for (const item of val) {
        collectFromValue(item);
      }
      return;
    }
    const record = val as Record<string, unknown>;
    for (const [key, value] of Object.entries(record)) {
      if (
        FCFA_AMOUNT_KEYS.has(key) &&
        typeof value === 'number' &&
        Number.isFinite(value)
      ) {
        authorizedAmounts.push(value);
      }
      collectFromValue(value);
    }
  }

  for (const call of successfulCalls) {
    if (call.name !== 'convertir_devise') {
      collectFromValue(call.result);
    }
  }

  // 3. Ajouter les montants autorisés issus de l'historique
  if (input.historyGrounding?.numbers) {
    authorizedAmounts.push(...input.historyGrounding.numbers);
  }

  const numericMatches = (val: number, list: readonly number[]): boolean => {
    return list.some((item) => Math.abs(item - val) <= 0.005);
  };

  // 4. Vérifier chaque montant_fcfa passé en argument à convertir_devise
  for (const call of convertCalls) {
    let montantFcfa: number | undefined;

    if (
      typeof call.arguments === 'object' &&
      call.arguments !== null &&
      'montant_fcfa' in call.arguments
    ) {
      montantFcfa = Number(
        (call.arguments as { montant_fcfa: unknown }).montant_fcfa,
      );
    } else if (typeof call.arguments === 'string') {
      try {
        const parsed = JSON.parse(call.arguments);
        if (parsed && typeof parsed === 'object' && 'montant_fcfa' in parsed) {
          montantFcfa = Number(parsed.montant_fcfa);
        }
      } catch {
        // ignore JSON parse errors
      }
    }

    if (montantFcfa !== undefined && Number.isFinite(montantFcfa)) {
      if (!numericMatches(montantFcfa, authorizedAmounts)) {
        return {
          rule: 'conversionSurMontantDeOutil',
          critique: `Contrôle qualité : tu as converti ${formatMontant(montantFcfa)} FCFA, un montant qui ne provient d'aucun résultat d'outil. Convertis un prix ou un total renvoyé par un outil (calculer_total), puis reformule.`,
        };
      }
    }
  }

  return null;
}
