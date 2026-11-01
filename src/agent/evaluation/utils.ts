import {
  filterSignificantWords,
  getSearchStems,
  normalizeText,
  wordMatches,
  type Product,
} from '../../domain/catalogue.js';
import type { TraceEvent } from '../trace.js';

export { filterSignificantWords, getSearchStems, normalizeText, wordMatches };

export interface SuccessfulToolCall {
  readonly name: string;
  readonly arguments: unknown;
  readonly result: Record<string, unknown>;
}

/**
 * Extracts all successful tool calls (events without error) from the tour trace.
 */
export function extractSuccessfulToolResults(
  trace: readonly TraceEvent[],
): SuccessfulToolCall[] {
  const successful: SuccessfulToolCall[] = [];
  for (const event of trace) {
    if (event.type === 'tool_call') {
      if (
        event.result &&
        typeof event.result === 'object' &&
        !('erreur' in event.result)
      ) {
        successful.push({
          name: event.name,
          arguments: event.arguments,
          result: event.result,
        });
      }
    }
  }
  return successful;
}

/**
 * Identifies products from catalogue cited in a given text (by reference Pxx or normalized name).
 */
export function identifyProductsInText(
  text: string,
  catalogue: readonly Product[],
): Product[] {
  const normalizedText = normalizeText(text);
  const found: Product[] = [];

  for (const product of catalogue) {
    // 1. Explicit reference check (e.g. P01, P03)
    const refRegex = new RegExp(`\\b${product.ref}\\b`, 'i');
    if (refRegex.test(text)) {
      found.push(product);
      continue;
    }

    // 2. Full normalized name check
    const normalizedNom = normalizeText(product.nom);
    if (normalizedText.includes(normalizedNom)) {
      found.push(product);
      continue;
    }

    // 3. Core name check without trailing specs (e.g. "500 g", "6 yards", "homme")
    const coreName = normalizedNom
      .replace(/\s+(?:500\s*g|6\s*yards|homme)$/i, '')
      .trim();
    if (coreName.length > 0 && normalizedText.includes(coreName)) {
      found.push(product);
      continue;
    }

    // 4. Plural tolerance on product core words (e.g. "robes en wax", "sacs en raphia", "sandale en cuir")
    const words = coreName.split(/\s+/).filter((w) => w.length > 0);
    if (words.length >= 2) {
      const pattern = words
        .map((w) => {
          if (w.endsWith('s')) {
            return `${w.slice(0, -1)}s?`;
          }
          return `${w}s?`;
        })
        .join('(?:\\s+(?:en|de)?\\s*|\\s+)');
      const pluralRegex = new RegExp(`\\b${pattern}\\b`, 'i');
      if (pluralRegex.test(normalizedText)) {
        found.push(product);
        continue;
      }
    }
  }

  return found;
}

/**
 * Recursively extracts all numerical values from any arbitrary JSON structure or string.
 */
export function extractNumbersFromValue(value: unknown): number[] {
  const numbers: number[] = [];

  function walk(val: unknown) {
    if (typeof val === 'number') {
      if (!Number.isNaN(val) && Number.isFinite(val)) {
        numbers.push(val);
      }
    } else if (typeof val === 'string') {
      const matches = val.matchAll(
        /(?:\b\d{1,3}(?:[ \u00A0\u202F]\d{3})+(?:[,\.]\d+)?|\b\d+(?:[,\.]\d+)?|\b\d+\b)/g,
      );
      for (const m of matches) {
        const cleaned = m[0].replace(/[ \u00A0\u202F]/g, '').replace(',', '.');
        const n = parseFloat(cleaned);
        if (!Number.isNaN(n) && Number.isFinite(n)) {
          numbers.push(n);
        }
      }
    } else if (Array.isArray(val)) {
      for (const item of val) walk(item);
    } else if (val !== null && typeof val === 'object') {
      for (const k of Object.keys(val)) {
        walk((val as Record<string, unknown>)[k]);
      }
    }
  }

  walk(value);
  return numbers;
}

export interface ExtractedNumber {
  readonly value: number;
  readonly isMonetary: boolean;
  readonly rawText: string;
}

const CURRENCY_POST_REGEX =
  /^[\s\(\[\-\:]*(F\s*CFA|FCFA|CFA|XOF|EUR|euros?|€|USD|dollars?|\$|NGN|nairas?|₦)(?=[^\w]|$)/i;

const CURRENCY_PRE_REGEX =
  /(F\s*CFA|FCFA|CFA|XOF|EUR|euros?|€|USD|dollars?|\$|NGN|nairas?|₦)[\s\(\[\-\:]*$/i;

/**
 * Extracts all numbers from reply text with monetary status and raw text,
 * ignoring line-initial list numbers and references.
 */
export function extractNumbersFromText(text: string): ExtractedNumber[] {
  // 1. Strip list numbers at the beginning of each line (e.g. "1.", "2)", "3 -")
  const textWithoutListNumbers = text.replace(/^[ \t]*\d+[\.\)][ \t]*/gm, ' ');

  // 2. Mask references (e.g. P01, P03, CMD-1)
  const textWithoutRefs = textWithoutListNumbers.replace(
    /\b[Pp]\d+\b|\bCMD-\d+\b/gi,
    '___REF___',
  );

  const numberPattern =
    /(?:(\d{1,3}(?:[ \u00A0\u202F]\d{3})+(?:[,\.]\d+)?)|(\d+(?:[,\.]\d+)?))/g;

  const results: ExtractedNumber[] = [];
  let match: RegExpExecArray | null;

  while ((match = numberPattern.exec(textWithoutRefs)) !== null) {
    const rawNumber = match[0];
    const cleaned = rawNumber.replace(/[ \u00A0\u202F]/g, '').replace(',', '.');
    const value = parseFloat(cleaned);

    if (Number.isNaN(value) || !Number.isFinite(value)) {
      continue;
    }

    const before = textWithoutRefs.slice(0, match.index);
    const after = textWithoutRefs.slice(match.index + rawNumber.length);

    const postMatch = after.match(CURRENCY_POST_REGEX);
    const preMatch = before.match(CURRENCY_PRE_REGEX);
    const isMonetary = postMatch !== null || preMatch !== null;

    let rawText = rawNumber;
    if (postMatch && postMatch[1]) {
      rawText = `${rawNumber} ${postMatch[1].trim()}`;
    } else if (preMatch && preMatch[1]) {
      rawText = `${preMatch[1].trim()} ${rawNumber}`;
    }

    results.push({
      value,
      isMonetary,
      rawText,
    });
  }

  return results;
}
