export const AGREEMENT_WORDS: ReadonlySet<string> = new Set([
  'oui',
  'ok',
  'okay',
  'daccord',
  'accord',
  'confirme',
  'valide',
  'parfait',
  'yes',
  'go',
  'marche',
  'bon',
]);

export const NEUTRAL_WORDS: ReadonlySet<string> = new Set([
  'je',
  'c',
  'cest',
  'est',
  'tout',
  'svp',
  'stp',
  'merci',
  'ca',
  'bien',
  'fait',
  'la',
  'le',
  'tres',
  'commande',
]);

export const ALL_ALLOWED_WORDS: ReadonlySet<string> = new Set([
  ...AGREEMENT_WORDS,
  ...NEUTRAL_WORDS,
]);

export const MAX_CONFIRMATION_WORDS = 6;

/**
 * Checks whether a text is an explicit order confirmation from the client.
 * Normalizes case, accents, punctuation, emojis, whitespace.
 * Accepts ONLY if:
 * 1. Contains no digits.
 * 2. Contains no question marks.
 * 3. Total words between 1 and 6.
 * 4. At least one word is in AGREEMENT_WORDS.
 * 5. EVERY word is in ALL_ALLOWED_WORDS.
 */
export function isExplicitConfirmation(text: unknown): boolean {
  if (typeof text !== 'string') {
    return false;
  }

  const trimmed = text.trim();
  if (trimmed.length === 0) {
    return false;
  }

  // Question mark marks inquiry/doubt: fail closed
  if (/[?؟\uFF1F]/.test(trimmed)) {
    return false;
  }

  // Any digit marks quantities/references/numbers: fail closed
  if (/\d/.test(trimmed)) {
    return false;
  }

  // Strip accents and convert to lower case
  const withoutAccents = trimmed
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();

  // Remove apostrophes so "d'accord" -> "daccord", "c'est" -> "cest"
  const withoutApostrophes = withoutAccents.replace(/['’`]/g, '');

  // Replace emojis, punctuation and any non-letter characters with whitespace
  const lettersOnly = withoutApostrophes.replace(/[^\p{L}\s]/gu, ' ');

  // Split into words
  const words = lettersOnly.split(/\s+/).filter(Boolean);

  if (words.length === 0 || words.length > MAX_CONFIRMATION_WORDS) {
    return false;
  }

  const hasAgreementWord = words.some((w) => AGREEMENT_WORDS.has(w));
  if (!hasAgreementWord) {
    return false;
  }

  const allWordsAllowed = words.every((w) => ALL_ALLOWED_WORDS.has(w));
  return allWordsAllowed;
}
