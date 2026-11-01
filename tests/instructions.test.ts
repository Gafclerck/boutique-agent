import { describe, expect, it } from 'vitest';
import { SYSTEM_INSTRUCTIONS } from '../src/agent/instructions.js';
import { INITIAL_PRODUCTS, INITIAL_ZONES } from '../src/domain/catalogue.js';

describe('Agent Instructions - Sanity and Purity', () => {
  it('contains no product names from the catalog', () => {
    const lowerInstructions = SYSTEM_INSTRUCTIONS.toLowerCase();

    for (const product of INITIAL_PRODUCTS) {
      expect(
        lowerInstructions.includes(product.nom.toLowerCase()),
        `Instructions should not contain product name: "${product.nom}"`,
      ).toBe(false);
    }

    // Explicit check for specific mentions
    expect(lowerInstructions).not.toContain('sac en raphia');
    expect(lowerInstructions).not.toContain('pagne wax');
    expect(lowerInstructions).not.toContain('chemise bazin');
    expect(lowerInstructions).not.toContain('sandales en cuir');
    expect(lowerInstructions).not.toContain('robe en wax');
    expect(lowerInstructions).not.toContain('beurre de karité');
  });

  it('contains no zone names from the catalog', () => {
    const lowerInstructions = SYSTEM_INSTRUCTIONS.toLowerCase();

    for (const zone of INITIAL_ZONES) {
      expect(
        lowerInstructions.includes(zone.zone.toLowerCase()),
        `Instructions should not contain zone name: "${zone.zone}"`,
      ).toBe(false);
    }
  });

  it('contains no catalog prices or real number examples', () => {
    for (const product of INITIAL_PRODUCTS) {
      // Check raw number
      expect(SYSTEM_INSTRUCTIONS).not.toContain(String(product.prix_fcfa));

      // Check formatted with thousands space (e.g. "12 000")
      const formatted = product.prix_fcfa.toLocaleString('fr-FR');
      expect(SYSTEM_INSTRUCTIONS).not.toContain(formatted);
    }

    // Specific examples previously present
    expect(SYSTEM_INSTRUCTIONS).not.toContain('12 000');
    expect(SYSTEM_INSTRUCTIONS).not.toContain('18,29');
    expect(SYSTEM_INSTRUCTIONS).not.toContain('7 500');
  });

  it('contains no shouting insistence words', () => {
    expect(SYSTEM_INSTRUCTIONS).not.toContain('OBLIGATOIREMENT');
    expect(SYSTEM_INSTRUCTIONS).not.toContain('SYSTEMATIQUEMENT');
    expect(SYSTEM_INSTRUCTIONS).not.toContain('SYSTÉMATIQUEMENT');
    expect(SYSTEM_INSTRUCTIONS).not.toContain('JAMAIS');
  });
});
