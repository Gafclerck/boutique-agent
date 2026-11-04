import { evaluateAlternativeEnRupture } from './rules/alternative-en-rupture.js';
import { evaluateAncrageDesNombres } from './rules/ancrage-des-nombres.js';
import { evaluateRechercheDabord } from './rules/recherche-dabord.js';
import { evaluateReponseCourte } from './rules/reponse-courte.js';
import { evaluateStockDabord } from './rules/stock-dabord.js';
import type { EvaluationInput, Verdict, Violation } from './types.js';

export * from './types.js';
export * from './utils.js';
export * from './judge-criteria.js';
export * from './judge.js';
export { evaluateAlternativeEnRupture } from './rules/alternative-en-rupture.js';
export { evaluateAncrageDesNombres } from './rules/ancrage-des-nombres.js';
export { evaluateRechercheDabord } from './rules/recherche-dabord.js';
export {
  evaluateReponseCourte,
  countWords,
  MAX_REPLY_WORDS,
} from './rules/reponse-courte.js';
export { evaluateStockDabord } from './rules/stock-dabord.js';

/**
 * Pure evaluation function that verifies that an agent reply complies with
 * quality rules against the tour trace and catalogue.
 * Returns all detected violations in a deterministic order.
 */
export function evaluateReply(input: EvaluationInput): Verdict {
  const violations: Violation[] = [];

  // Rule 1: rechercheD_abord
  const v1 = evaluateRechercheDabord(input);
  if (v1) violations.push(v1);

  // Rule 2: stockD_abord
  const v2 = evaluateStockDabord(input);
  if (v2) violations.push(v2);

  // Rule 3: alternativeEnRupture
  const v3 = evaluateAlternativeEnRupture(input);
  if (v3) violations.push(v3);

  // Rule 4: ancrageDesNombres
  const v4 = evaluateAncrageDesNombres(input);
  if (v4) violations.push(v4);

  // Rule 5: reponseCourte
  const v5 = evaluateReponseCourte(input);
  if (v5) violations.push(v5);

  return {
    ok: violations.length === 0,
    violations,
  };
}
