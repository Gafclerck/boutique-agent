import type { EvaluationInput, Violation } from '../types.js';
import { identifyProductsInText } from '../utils.js';

export function evaluateStockDabord(input: EvaluationInput): Violation | null {
  const citedProducts = identifyProductsInText(input.reply, input.catalogue);
  if (citedProducts.length === 0) {
    return null;
  }

  // Find all references verified with success in the trace
  const verifiedRefs = new Set<string>();
  for (const event of input.trace) {
    if (
      event.type === 'tool_call' &&
      event.name === 'verifier_stock' &&
      event.result &&
      !('erreur' in event.result)
    ) {
      const refFromResult =
        typeof event.result.ref === 'string' ? event.result.ref : undefined;
      const refFromArgs =
        typeof (event.arguments as { ref?: unknown })?.ref === 'string'
          ? (event.arguments as { ref: string }).ref
          : undefined;
      const ref = (refFromResult ?? refFromArgs)?.trim().toUpperCase();
      if (ref) {
        verifiedRefs.add(ref);
      }
    }
  }

  const unverified = citedProducts.filter(
    (product) => !verifiedRefs.has(product.ref.toUpperCase()),
  );

  if (unverified.length === 0) {
    return null;
  }

  const noms = unverified.map((p) => p.nom).join(', ');
  const refs = unverified.map((p) => p.ref).join(', ');

  return {
    rule: 'stockD_abord',
    critique: `Contrôle qualité : tu mentionnes ${noms} sans avoir vérifié leur stock. Appelle verifier_stock pour ${refs}, puis reformule ta réponse.`,
  };
}
