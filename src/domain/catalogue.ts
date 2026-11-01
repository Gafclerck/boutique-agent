export interface Product {
  readonly ref: string;
  readonly nom: string;
  readonly categorie: string;
  readonly prix_fcfa: number;
  readonly stock: number;
}

export interface Zone {
  readonly zone: string;
  readonly frais_fcfa: number;
  readonly delai: string;
}

export const INITIAL_PRODUCTS: readonly Product[] = [
  { ref: 'P01', nom: 'Pagne wax 6 yards', categorie: 'tissu', prix_fcfa: 12000, stock: 14 },
  { ref: 'P02', nom: 'Chemise bazin homme', categorie: 'vetement', prix_fcfa: 18500, stock: 3 },
  { ref: 'P03', nom: 'Sac en raphia', categorie: 'accessoire', prix_fcfa: 7500, stock: 0 },
  { ref: 'P04', nom: 'Sandales en cuir', categorie: 'accessoire', prix_fcfa: 9000, stock: 8 },
  { ref: 'P05', nom: 'Robe en wax', categorie: 'vetement', prix_fcfa: 22000, stock: 5 },
  { ref: 'P06', nom: 'Beurre de karité 500 g', categorie: 'soin', prix_fcfa: 3500, stock: 40 },
];

export const INITIAL_ZONES: readonly Zone[] = [
  { zone: 'Cotonou', frais_fcfa: 1000, delai: '24 à 48 h' },
  { zone: 'Akpakpa', frais_fcfa: 1000, delai: '24 à 48 h' },
  { zone: 'Fidjrossè', frais_fcfa: 1500, delai: '24 à 48 h' },
  { zone: 'Calavi', frais_fcfa: 2000, delai: '24 à 48 h' },
  { zone: 'Porto-Novo', frais_fcfa: 3000, delai: '24 à 48 h' },
  { zone: 'Ouidah', frais_fcfa: 3500, delai: '24 à 48 h' },
];

export const CANONICAL_ZONE_NAMES: readonly string[] = INITIAL_ZONES.map((z) => z.zone);

export const STOP_WORDS: ReadonlySet<string> = new Set([
  'de',
  'du',
  'des',
  'd',
  'le',
  'la',
  'les',
  'l',
  'un',
  'une',
  'en',
  'et',
  'a',
  'au',
  'aux',
  'pour',
  'sur',
]);

export function normalizeText(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

export function extractWords(text: string): string[] {
  const normalized = normalizeText(text);
  if (!normalized) return [];
  return normalized.split(/[^a-z0-9]+/i).filter((w) => w.length > 0);
}

export function filterSignificantWords(text: string): string[] {
  const words = extractWords(text);
  return words.filter((w) => !STOP_WORDS.has(w));
}

/**
 * Handles basic French plural stems:
 * e.g., "pagnes" -> "pagne", "chevaux" -> "cheval", "bijoux" -> "bijou"
 */
export function getSearchStems(keyword: string): string[] {
  const normalized = normalizeText(keyword);
  if (!normalized) return [];

  const stems = new Set<string>([normalized]);

  if (normalized.endsWith('s') && normalized.length > 2) {
    stems.add(normalized.slice(0, -1));
  }
  if (normalized.endsWith('x') && normalized.length > 2) {
    stems.add(normalized.slice(0, -1));
    if (normalized.endsWith('aux')) {
      stems.add(normalized.slice(0, -3) + 'al');
    }
  }

  return Array.from(stems);
}

export function wordMatches(queryWord: string, targetWords: readonly string[]): boolean {
  const queryStems = getSearchStems(queryWord);
  for (const target of targetWords) {
    if (queryWord === target) return true;
    const targetStems = getSearchStems(target);
    if (queryStems.some((qs) => targetStems.includes(qs))) {
      return true;
    }
  }
  return false;
}
