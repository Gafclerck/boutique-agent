import { describe, expect, it } from 'vitest';
import { isExplicitConfirmation } from '../src/domain/confirmation.js';

describe('Confirmation explicite du client (isExplicitConfirmation)', () => {
  it('accepte les formulations valides du prompt', () => {
    expect(isExplicitConfirmation('oui je confirme')).toBe(true);
    expect(isExplicitConfirmation('Oui !')).toBe(true);
    expect(isExplicitConfirmation("ok c'est bon")).toBe(true);
    expect(isExplicitConfirmation("d'accord")).toBe(true);
    expect(isExplicitConfirmation('confirmé')).toBe(true);
    expect(isExplicitConfirmation('Parfait merci')).toBe(true);
  });

  it('accepte des variantes valides avec emojis et ponctuation', () => {
    expect(isExplicitConfirmation('Oui 🙏')).toBe(true);
    expect(isExplicitConfirmation('OK merci beaucoup...')).toBe(false); // "beaucoup" is not in whitelist
    expect(isExplicitConfirmation('oui merci stp')).toBe(true);
    expect(isExplicitConfirmation('Valide !')).toBe(true);
    expect(isExplicitConfirmation('c est bon')).toBe(true);
    expect(isExplicitConfirmation('oui c est tres bien fait')).toBe(true);
    expect(isExplicitConfirmation('yes')).toBe(true);
    expect(isExplicitConfirmation('go')).toBe(true);
    expect(isExplicitConfirmation('marche')).toBe(true);
  });

  it('refuse les cas du prompt', () => {
    expect(isExplicitConfirmation('oui mais 3 robes')).toBe(false);
    expect(isExplicitConfirmation('non')).toBe(false);
    expect(isExplicitConfirmation('je ne confirme pas')).toBe(false);
    expect(isExplicitConfirmation("oui et la livraison c'est combien ?")).toBe(false);
    expect(isExplicitConfirmation('ok 2 robes')).toBe(false);
    expect(isExplicitConfirmation('')).toBe(false);
  });

  it('refuse les questions et les doutes', () => {
    expect(isExplicitConfirmation('oui ?')).toBe(false);
    expect(isExplicitConfirmation('ok ?')).toBe(false);
    expect(isExplicitConfirmation('daccord ?')).toBe(false);
  });

  it('refuse les textes de plus de 6 mots', () => {
    // 6 words: accepted
    expect(isExplicitConfirmation('oui je confirme tout est bon')).toBe(true);
    // 7 words: refused
    expect(isExplicitConfirmation('oui je confirme tout est tres bon')).toBe(false);
  });

  it('refuse les mots hors liste blanche', () => {
    expect(isExplicitConfirmation('oui j achete')).toBe(false);
    expect(isExplicitConfirmation('oui envoyez')).toBe(false);
    expect(isExplicitConfirmation('peut etre')).toBe(false);
  });

  it('refuse les types non string ou vides', () => {
    expect(isExplicitConfirmation(null)).toBe(false);
    expect(isExplicitConfirmation(undefined)).toBe(false);
    expect(isExplicitConfirmation(123)).toBe(false);
    expect(isExplicitConfirmation('   ')).toBe(false);
  });
});
