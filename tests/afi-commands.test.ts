import { describe, expect, it } from 'vitest';
import {
  looksLikeAfiCommand,
  parseAfiDecision,
} from '../src/domain/afi-commands.js';

describe("Commandes d'Afi (parseAfiDecision et looksLikeAfiCommand)", () => {
  it('accepte les commandes valides du prompt', () => {
    expect(parseAfiDecision('OUI 12')).toEqual({ decision: 'oui', numero: 12 });
    expect(parseAfiDecision('oui 12')).toEqual({ decision: 'oui', numero: 12 });
    expect(parseAfiDecision('Non #7')).toEqual({ decision: 'non', numero: 7 });

    expect(looksLikeAfiCommand('OUI 12')).toBe(true);
    expect(looksLikeAfiCommand('oui 12')).toBe(true);
    expect(looksLikeAfiCommand('Non #7')).toBe(true);
  });

  it('gère les variantes d espacement et de casse', () => {
    expect(parseAfiDecision('   oui   #42   ')).toEqual({
      decision: 'oui',
      numero: 42,
    });
    expect(parseAfiDecision('NON 100')).toEqual({
      decision: 'non',
      numero: 100,
    });
  });

  it('refuse les formats invalides du prompt', () => {
    expect(parseAfiDecision('oui 12 svp')).toBeNull();
    expect(parseAfiDecision('OUI')).toBeNull();
    expect(parseAfiDecision('12 oui')).toBeNull();
    expect(parseAfiDecision('oui12')).toBeNull();

    expect(looksLikeAfiCommand('oui 12 svp')).toBe(false);
    expect(looksLikeAfiCommand('OUI')).toBe(false);
    expect(looksLikeAfiCommand('12 oui')).toBe(false);
    expect(looksLikeAfiCommand('oui12')).toBe(false);
  });

  it('refuse les numéros de plus de 6 chiffres ou négatifs', () => {
    expect(parseAfiDecision('oui 1234567')).toBeNull();
    expect(parseAfiDecision('oui -5')).toBeNull();
  });

  it('refuse les entrées non textuelles', () => {
    expect(parseAfiDecision(null)).toBeNull();
    expect(parseAfiDecision(undefined)).toBeNull();
    expect(parseAfiDecision(42)).toBeNull();
  });
});
