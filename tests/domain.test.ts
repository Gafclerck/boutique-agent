import { describe, expect, it } from 'vitest';
import {
  CANONICAL_ZONE_NAMES,
  INITIAL_PRODUCTS,
  normalizeText,
} from '../src/domain/catalogue.js';
import { calculateTotal } from '../src/domain/pricing.js';
import { Shop, InvalidKeywordError } from '../src/domain/shop.js';

describe('Domain - Catalogue and Text Normalization', () => {
  it('normalizes accents, casing, and whitespace', () => {
    expect(normalizeText('  Fidjrossè  ')).toBe('fidjrosse');
    expect(normalizeText('PAGNE WAX 6 YARDS')).toBe('pagne wax 6 yards');
    expect(normalizeText('Beurre de karité 500 g')).toBe('beurre de karite 500 g');
  });

  it('contains all 6 required initial products with correct categories', () => {
    expect(INITIAL_PRODUCTS).toHaveLength(6);
    const refs = INITIAL_PRODUCTS.map((p) => p.ref);
    expect(refs).toEqual(['P01', 'P02', 'P03', 'P04', 'P05', 'P06']);

    const expectedCategories: Record<string, string> = {
      P01: 'tissu',
      P02: 'vetement',
      P03: 'accessoire',
      P04: 'accessoire',
      P05: 'vetement',
      P06: 'soin',
    };

    for (const p of INITIAL_PRODUCTS) {
      expect(p.categorie).toBe(expectedCategories[p.ref]);
    }
  });
});

describe('Domain - Shop Search', () => {
  it('finds products by singular keyword ignoring case and accents', () => {
    const shop = new Shop();
    const results = shop.searchProducts('pagne');
    expect(results).toHaveLength(1);
    expect(results[0]?.ref).toBe('P01');
    expect(results[0]?.nom).toBe('Pagne wax 6 yards');
    expect(results[0]?.categorie).toBe('tissu');
  });

  it('finds products by category keyword (e.g. "accessoire" finds P03 and P04)', () => {
    const shop = new Shop();
    const results = shop.searchProducts('accessoire');
    expect(results).toHaveLength(2);
    expect(results.map((r) => r.ref).sort()).toEqual(['P03', 'P04']);
  });

  it('finds products by plural category keyword (e.g. "vetements" finds P02 and P05)', () => {
    const shop = new Shop();
    const results = shop.searchProducts('vetements');
    expect(results).toHaveLength(2);
    expect(results.map((r) => r.ref).sort()).toEqual(['P02', 'P05']);
  });

  it('tolerates simple plurals (e.g. "pagnes" finds "Pagne wax 6 yards")', () => {
    const shop = new Shop();
    const results = shop.searchProducts('pagnes');
    expect(results).toHaveLength(1);
    expect(results[0]?.ref).toBe('P01');
  });

  it('tolerates plural stem on other products (e.g. "sandales")', () => {
    const shop = new Shop();
    const results = shop.searchProducts('sandales');
    expect(results).toHaveLength(1);
    expect(results[0]?.ref).toBe('P04');
    expect(results[0]?.nom).toBe('Sandales en cuir');
    expect(results[0]?.categorie).toBe('accessoire');
  });

  it('finds products with accents without needing accents in search', () => {
    const shop = new Shop();
    const results = shop.searchProducts('karite');
    expect(results).toHaveLength(1);
    expect(results[0]?.ref).toBe('P06');
    expect(results[0]?.nom).toBe('Beurre de karité 500 g');
    expect(results[0]?.categorie).toBe('soin');
  });

  it('finds products with multi-words, stop-words ignored, and order indifferent', () => {
    const shop = new Shop();

    // "sac raphia" -> P03
    const sacRaphia = shop.searchProducts('sac raphia');
    expect(sacRaphia.map((p) => p.ref)).toEqual(['P03']);

    // "sac en raphia" -> P03
    const sacEnRaphia = shop.searchProducts('sac en raphia');
    expect(sacEnRaphia.map((p) => p.ref)).toEqual(['P03']);

    // "raphia" -> P03
    const raphia = shop.searchProducts('raphia');
    expect(raphia.map((p) => p.ref)).toEqual(['P03']);

    // "Sacs" -> P03
    const sacs = shop.searchProducts('Sacs');
    expect(sacs.map((p) => p.ref)).toEqual(['P03']);

    // "robe wax" -> P05
    const robeWax = shop.searchProducts('robe wax');
    expect(robeWax.map((p) => p.ref)).toEqual(['P05']);

    // "wax robe" -> P05
    const waxRobe = shop.searchProducts('wax robe');
    expect(waxRobe.map((p) => p.ref)).toEqual(['P05']);

    // "beurre karite" -> P06
    const beurreKarite = shop.searchProducts('beurre karite');
    expect(beurreKarite.map((p) => p.ref)).toEqual(['P06']);

    // "bazin" -> P02
    const bazin = shop.searchProducts('bazin');
    expect(bazin.map((p) => p.ref)).toEqual(['P02']);

    // "accessoires" -> P03, P04
    const accessoires = shop.searchProducts('accessoires');
    expect(accessoires.map((p) => p.ref).sort()).toEqual(['P03', 'P04']);

    // "pagne wax" -> P01
    const pagneWax = shop.searchProducts('pagne wax');
    expect(pagneWax.map((p) => p.ref)).toEqual(['P01']);
  });

  it('returns empty array when keyword does not match anything', () => {
    const shop = new Shop();
    expect(shop.searchProducts('sac wax')).toEqual([]);
    expect(shop.searchProducts('ordinateur')).toEqual([]);
  });

  it('throws InvalidKeywordError when keyword is empty or only stop-words', () => {
    const shop = new Shop();
    expect(() => shop.searchProducts('')).toThrow(InvalidKeywordError);
    expect(() => shop.searchProducts('')).toThrow('mot-clé invalide');
    expect(() => shop.searchProducts('en')).toThrow(InvalidKeywordError);
    expect(() => shop.searchProducts('en')).toThrow('mot-clé invalide');
    expect(() => shop.searchProducts('de la')).toThrow(InvalidKeywordError);
    expect(() => shop.searchProducts('de la')).toThrow('mot-clé invalide');
  });
});

describe('Domain - Delivery Zones', () => {
  it('finds Fidjrossè with "fidjrosse" (accent and case insensitive)', () => {
    const shop = new Shop();
    const zone = shop.getDeliveryZone('fidjrosse');
    expect(zone).not.toBeNull();
    expect(zone?.zone).toBe('Fidjrossè');
    expect(zone?.frais_fcfa).toBe(1500);
    expect(zone?.delai).toBe('24 à 48 h');
  });

  it('matches all other defined zones', () => {
    const shop = new Shop();
    expect(shop.getDeliveryZone('Cotonou')?.frais_fcfa).toBe(1000);
    expect(shop.getDeliveryZone('akpakpa')?.frais_fcfa).toBe(1000);
    expect(shop.getDeliveryZone('CALAVI')?.frais_fcfa).toBe(2000);
    expect(shop.getDeliveryZone('porto-novo')?.frais_fcfa).toBe(3000);
    expect(shop.getDeliveryZone('ouidah')?.frais_fcfa).toBe(3500);
  });

  it('returns null for unserviced zones', () => {
    const shop = new Shop();
    expect(shop.getDeliveryZone('Lomé')).toBeNull();
    expect(shop.getDeliveryZone('Paris')).toBeNull();
    expect(shop.getDeliveryZone('Abidjan')).toBeNull();
  });
});

describe('Domain - Pricing Calculation', () => {
  it('calculates total as sum of (unit_price * quantity) + delivery_fee', () => {
    const items = [
      { prix_unitaire_fcfa: 12000, quantite: 2 },
      { prix_unitaire_fcfa: 3500, quantite: 1 },
    ];
    const deliveryFee = 1500;
    const total = calculateTotal(items, deliveryFee);
    // (12000 * 2) + 3500 + 1500 = 24000 + 3500 + 1500 = 29000
    expect(total).toBe(29000);
  });

  it('handles empty items array', () => {
    expect(calculateTotal([], 1000)).toBe(1000);
  });
});

describe('Domain - Stock Decrement and Atomicity', () => {
  it('decrements stock on successful order', async () => {
    const shop = new Shop();
    const initialCheck = await shop.checkStock('P01');
    expect(initialCheck?.stock).toBe(14);
    expect(initialCheck?.categorie).toBe('tissu');

    const result = await shop.placeOrder({
      clientNom: 'Koffi Mensah',
      zone: 'Cotonou',
      articles: [{ ref: 'P01', quantite: 2 }],
    });

    expect(result.success).toBe(true);
    if (!result.success) return;

    expect(result.order.numero_commande).toBe('CMD-1');
    expect(result.order.articles[0]?.quantite).toBe(2);
    expect(result.order.articles[0]?.sous_total_fcfa).toBe(24000);
    expect(result.order.frais_livraison_fcfa).toBe(1000);
    expect(result.order.total_fcfa).toBe(25000);

    const postCheck = await shop.checkStock('P01');
    expect(postCheck?.stock).toBe(12);
  });

  it('guarantees atomicity: no stock is decremented if one article has insufficient stock', async () => {
    const shop = new Shop();
    // P01 has 14 in stock, P03 has 0 in stock
    const p01Initial = (await shop.checkStock('P01'))?.stock;
    const p03Initial = (await shop.checkStock('P03'))?.stock;
    expect(p01Initial).toBe(14);
    expect(p03Initial).toBe(0);

    const result = await shop.placeOrder({
      clientNom: 'Amina S.',
      zone: 'Calavi',
      articles: [
        { ref: 'P01', quantite: 2 },
        { ref: 'P03', quantite: 1 },
      ],
    });

    expect(result.success).toBe(false);
    if (result.success) return;

    expect(result.reason).toBe('INSUFFICIENT_STOCK');
    expect(result.message).toContain('stock insuffisant pour Sac en raphia');

    // P01 stock MUST NOT have changed!
    expect((await shop.checkStock('P01'))?.stock).toBe(14);
    expect((await shop.checkStock('P03'))?.stock).toBe(0);
    expect(await shop.getOrders()).toHaveLength(0);
  });

  it('fails atomically if reference is unknown', async () => {
    const shop = new Shop();
    const result = await shop.placeOrder({
      clientNom: 'Amina',
      zone: 'Cotonou',
      articles: [
        { ref: 'P01', quantite: 1 },
        { ref: 'P99', quantite: 1 },
      ],
    });

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.reason).toBe('UNKNOWN_REFERENCE');
    expect((await shop.checkStock('P01'))?.stock).toBe(14);
  });

  it('fails atomically if zone is not serviced', async () => {
    const shop = new Shop();
    const result = await shop.placeOrder({
      clientNom: 'Amina',
      zone: 'Lomé',
      articles: [{ ref: 'P01', quantite: 1 }],
    });

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.reason).toBe('UNSERVICED_ZONE');
    if (result.reason === 'UNSERVICED_ZONE') {
      expect(result.zones_desservies).toEqual(CANONICAL_ZONE_NAMES);
    }
    expect((await shop.checkStock('P01'))?.stock).toBe(14);
  });

  it('gère deux placeOrder concurrents sur P05 avec stock initial 1 : un seul succès et stock final 0', async () => {
    const shop = new Shop();
    await shop.getStore().transact((state) => {
      state.stock['P05'] = 1;
    });

    const [resA, resB] = await Promise.all([
      shop.placeOrder({
        clientNom: 'A',
        zone: 'Cotonou',
        articles: [{ ref: 'P05', quantite: 1 }],
      }),
      shop.placeOrder({
        clientNom: 'B',
        zone: 'Calavi',
        articles: [{ ref: 'P05', quantite: 1 }],
      }),
    ]);

    const successes = [resA, resB].filter((r) => r.success);
    const failures = [resA, resB].filter((r) => !r.success);
    expect(successes).toHaveLength(1);
    expect(failures).toHaveLength(1);
    expect(failures[0]?.reason).toBe('INSUFFICIENT_STOCK');
    expect((await shop.checkStock('P05'))?.stock).toBe(0);
  });
});
