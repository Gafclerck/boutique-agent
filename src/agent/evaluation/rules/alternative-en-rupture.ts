import type { EvaluationInput, Violation } from '../types.js';
import { identifyProductsInText } from '../utils.js';

// NOTE : Cette règle pure vérifie uniquement la présence d'au moins une alternative
// citée dans la réponse dont le stock a été vérifié > 0 dans le tour.
// Elle ne juge pas de la pertinence métier ni de la cohérence sémantique de l'alternative
// proposée (cette appréciation qualitative est réservée au juge LLM au palier suivant).
export function evaluateAlternativeEnRupture(
  input: EvaluationInput,
): Violation | null {
  // 1. Collect all verifier_stock calls in the trace where stock === 0
  const outOfStockCalls: Array<{
    ref: string;
    nom: string;
    categorie: string;
  }> = [];

  // Also collect all refs with verified stock > 0 in the trace
  const inStockVerifiedRefs = new Set<string>();

  for (const event of input.trace) {
    if (
      event.type === 'tool_call' &&
      event.name === 'verifier_stock' &&
      event.result &&
      !('erreur' in event.result)
    ) {
      const stock = event.result.stock;
      const rawRef =
        (typeof event.result.ref === 'string'
          ? event.result.ref
          : typeof (event.arguments as { ref?: unknown })?.ref === 'string'
            ? (event.arguments as { ref: string }).ref
            : '')
          .trim()
          .toUpperCase();

      if (!rawRef) continue;

      if (typeof stock === 'number' && stock > 0) {
        inStockVerifiedRefs.add(rawRef);
      } else if (stock === 0) {
        const product = input.catalogue.find(
          (p) => p.ref.toUpperCase() === rawRef,
        );
        const nom =
          product?.nom ??
          (typeof event.result.nom === 'string' ? event.result.nom : rawRef);
        const categorie =
          product?.categorie ??
          (typeof event.result.categorie === 'string'
            ? event.result.categorie
            : 'accessoire');

        outOfStockCalls.push({ ref: rawRef, nom, categorie });
      }
    }
  }

  if (outOfStockCalls.length === 0) {
    return null;
  }

  // Identify all products cited in the reply
  const citedProducts = identifyProductsInText(input.reply, input.catalogue);

  for (const oos of outOfStockCalls) {
    const hasVerifiedAlternative = citedProducts.some(
      (p) =>
        p.ref.toUpperCase() !== oos.ref &&
        inStockVerifiedRefs.has(p.ref.toUpperCase()),
    );

    if (!hasVerifiedAlternative) {
      return {
        rule: 'alternativeEnRupture',
        critique: `Contrôle qualité : ${oos.nom} est en rupture mais ta réponse ne propose aucune alternative vérifiée. Cherche avec chercher_produits dans la catégorie ${oos.categorie}, vérifie le stock avec verifier_stock, puis propose-la dans la même réponse.`,
      };
    }
  }

  return null;
}
