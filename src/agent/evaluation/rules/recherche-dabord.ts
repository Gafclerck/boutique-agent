import type { EvaluationInput, Violation } from '../types.js';
import { filterSignificantWords, wordMatches } from '../utils.js';

export function evaluateRechercheDabord(
  input: EvaluationInput,
): Violation | null {
  if (input.hasPriorCatalogueLookup) {
    return null;
  }

  const hasSearchInTour = input.trace.some(
    (event) => event.type === 'tool_call' && event.name === 'chercher_produits',
  );
  if (hasSearchInTour) {
    return null;
  }

  // Collect all significant words from catalogue products (names and categories)
  const catalogueWords = new Set<string>();
  for (const product of input.catalogue) {
    for (const word of filterSignificantWords(product.nom)) {
      if (word.length >= 2 && !/^\d+$/.test(word)) {
        catalogueWords.add(word);
      }
    }
    for (const word of filterSignificantWords(product.categorie)) {
      if (word.length >= 2 && !/^\d+$/.test(word)) {
        catalogueWords.add(word);
      }
    }
  }

  const catalogueWordsList = Array.from(catalogueWords);

  // Check significant words in user message
  const userWords = filterSignificantWords(input.userMessage);
  const matchedTerms: string[] = [];

  for (const uWord of userWords) {
    if (uWord.length < 2 || /^\d+$/.test(uWord)) continue;
    if (wordMatches(uWord, catalogueWordsList)) {
      matchedTerms.push(uWord);
    }
  }

  if (matchedTerms.length === 0) {
    return null;
  }

  // Deduplicate matched terms maintaining order of appearance
  const uniqueTerms = Array.from(new Set(matchedTerms));

  return {
    rule: 'rechercheD_abord',
    critique: `Contrôle qualité : le client parle de ${uniqueTerms.join(', ')} du catalogue. Appelle chercher_produits avant de répondre, sans poser de question au client.`,
  };
}
