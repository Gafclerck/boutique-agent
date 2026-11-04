import { describe, expect, it } from 'vitest';
import { SYSTEM_INSTRUCTIONS } from '../src/agent/instructions.js';
import {
  GERANT_INSTRUCTIONS,
  LOGISTICIEN_INSTRUCTIONS,
  REDACTEUR_INSTRUCTIONS,
  VENDEUR_INSTRUCTIONS,
} from '../src/agent/team/team-instructions.js';
import { INITIAL_PRODUCTS, INITIAL_ZONES } from '../src/domain/catalogue.js';

const ALL_INSTRUCTION_SETS = [
  { name: 'Agent seul (SYSTEM_INSTRUCTIONS)', text: SYSTEM_INSTRUCTIONS },
  { name: 'Gérant (GERANT_INSTRUCTIONS)', text: GERANT_INSTRUCTIONS },
  { name: 'Vendeur (VENDEUR_INSTRUCTIONS)', text: VENDEUR_INSTRUCTIONS },
  { name: 'Logisticien (LOGISTICIEN_INSTRUCTIONS)', text: LOGISTICIEN_INSTRUCTIONS },
  { name: 'Rédacteur (REDACTEUR_INSTRUCTIONS)', text: REDACTEUR_INSTRUCTIONS },
];

describe('Agent and Team Instructions - Sanity and Purity', () => {
  for (const { name, text } of ALL_INSTRUCTION_SETS) {
    describe(`Instructions pureté : ${name}`, () => {
      it('contains no product names from the catalog', () => {
        const lowerInstructions = text.toLowerCase();

        for (const product of INITIAL_PRODUCTS) {
          expect(
            lowerInstructions.includes(product.nom.toLowerCase()),
            `${name} should not contain product name: "${product.nom}"`,
          ).toBe(false);
        }

        expect(lowerInstructions).not.toContain('sac en raphia');
        expect(lowerInstructions).not.toContain('pagne wax');
        expect(lowerInstructions).not.toContain('chemise bazin');
        expect(lowerInstructions).not.toContain('sandales en cuir');
        expect(lowerInstructions).not.toContain('robe en wax');
        expect(lowerInstructions).not.toContain('beurre de karité');
      });

      it('contains no zone names from the catalog', () => {
        const lowerInstructions = text.toLowerCase();

        for (const zone of INITIAL_ZONES) {
          expect(
            lowerInstructions.includes(zone.zone.toLowerCase()),
            `${name} should not contain zone name: "${zone.zone}"`,
          ).toBe(false);
        }
      });

      it('contains no catalog prices or real number examples', () => {
        for (const product of INITIAL_PRODUCTS) {
          expect(text).not.toContain(String(product.prix_fcfa));

          const formatted = product.prix_fcfa.toLocaleString('fr-FR');
          expect(text).not.toContain(formatted);
        }

        expect(text).not.toContain('12 000');
        expect(text).not.toContain('18,29');
        expect(text).not.toContain('7 500');
      });

      it('contains no shouting insistence words', () => {
        expect(text).not.toContain('OBLIGATOIREMENT');
        expect(text).not.toContain('SYSTEMATIQUEMENT');
        expect(text).not.toContain('SYSTÉMATIQUEMENT');
        expect(text).not.toContain('JAMAIS');
      });
    });
  }
});
