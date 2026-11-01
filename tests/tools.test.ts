import { describe, expect, it } from 'vitest';
import { CANONICAL_ZONE_NAMES } from '../src/domain/catalogue.js';
import { Shop } from '../src/domain/shop.js';
import { ChercherProduitsTool } from '../src/tools/chercher-produits.js';
import { ConvertirDeviseTool } from '../src/tools/convertir-devise.js';
import { CreerCommandeTool } from '../src/tools/creer-commande.js';
import { FraisLivraisonTool } from '../src/tools/frais-livraison.js';
import { VerifierStockTool } from '../src/tools/verifier-stock.js';

describe('Tool - chercher_produits', () => {
  it('returns products list on successful match with categorie field and without stock', async () => {
    const shop = new Shop();
    const tool = new ChercherProduitsTool(shop);

    const result = await tool.execute({ mot_cle: 'pagne' });
    expect(result).toEqual({
      produits: [
        {
          ref: 'P01',
          nom: 'Pagne wax 6 yards',
          categorie: 'tissu',
          prix_fcfa: 12000,
        },
      ],
    });
  });

  it('searches by category keyword and returns all matching products', async () => {
    const shop = new Shop();
    const tool = new ChercherProduitsTool(shop);

    const result = await tool.execute({ mot_cle: 'accessoire' });
    expect(result).toEqual({
      produits: [
        {
          ref: 'P03',
          nom: 'Sac en raphia',
          categorie: 'accessoire',
          prix_fcfa: 7500,
        },
        {
          ref: 'P04',
          nom: 'Sandales en cuir',
          categorie: 'accessoire',
          prix_fcfa: 9000,
        },
      ],
    });
  });

  it('has updated description with multi-word and category advice', () => {
    const shop = new Shop();
    const tool = new ChercherProduitsTool(shop);
    expect(tool.description).toContain(
      "Un ou deux mots suffisent (ex : pagne, sac raphia, robe wax). Si rien ne correspond, réessayer une fois avec un mot plus général ou une catégorie avant d'interroger le client.",
    );
  });

  it('returns exact observation error when no product matches with enriched advice', async () => {
    const shop = new Shop();
    const tool = new ChercherProduitsTool(shop);

    const result = await tool.execute({ mot_cle: 'chapeau' });
    expect(result).toEqual({
      erreur: 'aucun produit pour chapeau',
      conseil:
        'essayer un mot plus général ou une catégorie (tissu, vetement, accessoire, soin)',
    });
  });

  it('returns observation error "mot-clé invalide" when keyword is empty or only stop-words', async () => {
    const shop = new Shop();
    const tool = new ChercherProduitsTool(shop);

    const emptyResult = await tool.execute({ mot_cle: '' });
    expect(emptyResult).toEqual({
      erreur: 'mot-clé invalide',
      conseil:
        'un ou deux mots suffisent (ex : pagne, sac raphia, robe wax) ou une catégorie (tissu, vetement, accessoire, soin)',
    });

    const stopWordResult = await tool.execute({ mot_cle: 'en' });
    expect(stopWordResult).toEqual({
      erreur: 'mot-clé invalide',
      conseil:
        'un ou deux mots suffisent (ex : pagne, sac raphia, robe wax) ou une catégorie (tissu, vetement, accessoire, soin)',
    });

    const multiStopWordResult = await tool.execute({ mot_cle: 'de la' });
    expect(multiStopWordResult).toEqual({
      erreur: 'mot-clé invalide',
      conseil:
        'un ou deux mots suffisent (ex : pagne, sac raphia, robe wax) ou une catégorie (tissu, vetement, accessoire, soin)',
    });
  });

  it('returns observation error on invalid arguments', async () => {
    const shop = new Shop();
    const tool = new ChercherProduitsTool(shop);

    const result = await tool.execute({});
    expect(result).toEqual({
      erreur: 'argument invalide',
      conseil: 'fournir un mot-clé sous la forme {"mot_cle": "nom_du_produit"}',
    });
  });

  it('finds products with multi-word search (e.g. "sac raphia")', async () => {
    const shop = new Shop();
    const tool = new ChercherProduitsTool(shop);

    const result = await tool.execute({ mot_cle: 'sac raphia' });
    expect(result).toEqual({
      produits: [
        {
          ref: 'P03',
          nom: 'Sac en raphia',
          categorie: 'accessoire',
          prix_fcfa: 7500,
        },
      ],
    });
  });
});

describe('Tool - verifier_stock', () => {
  it('returns stock information with categorie and disponible boolean', async () => {
    const shop = new Shop();
    const tool = new VerifierStockTool(shop);

    const result = await tool.execute({ ref: 'P01' });
    expect(result).toEqual({
      ref: 'P01',
      nom: 'Pagne wax 6 yards',
      categorie: 'tissu',
      stock: 14,
      disponible: true,
    });
  });

  it('returns disponible = false, categorie, and conseil when stock is 0 (P03)', async () => {
    const shop = new Shop();
    const tool = new VerifierStockTool(shop);

    const result = await tool.execute({ ref: 'P03' });
    expect(result).toEqual({
      ref: 'P03',
      nom: 'Sac en raphia',
      categorie: 'accessoire',
      stock: 0,
      disponible: false,
      conseil:
        'article en rupture : chercher une alternative avec chercher_produits en utilisant la catégorie, puis vérifier son stock avec verifier_stock avant de la proposer',
    });
  });

  it('returns exact error when reference is unknown', async () => {
    const shop = new Shop();
    const tool = new VerifierStockTool(shop);

    const result = await tool.execute({ ref: 'P99' });
    expect(result).toEqual({
      erreur: 'référence inconnue',
      conseil: 'utiliser chercher_produits pour trouver la bonne référence',
    });
  });
});

describe('Tool - frais_livraison', () => {
  it('returns canonical zone, fee, and delay', async () => {
    const shop = new Shop();
    const tool = new FraisLivraisonTool(shop);

    const result = await tool.execute({ zone: 'fidjrosse' });
    expect(result).toEqual({
      zone: 'Fidjrossè',
      frais_fcfa: 1500,
      delai: '24 à 48 h',
    });
  });

  it('returns exact error and serviced zones list for unserviced zone', async () => {
    const shop = new Shop();
    const tool = new FraisLivraisonTool(shop);

    const result = await tool.execute({ zone: 'Lomé' });
    expect(result).toEqual({
      erreur: 'zone non desservie',
      zones_desservies: [...CANONICAL_ZONE_NAMES],
    });
  });
});

describe('Tool - convertir_devise with Fake Fetch', () => {
  it('converts successfully using XOF base response', async () => {
    const fakeFetch: typeof fetch = async (input) => {
      const url = String(input);
      if (url.includes('/XOF')) {
        return new Response(
          JSON.stringify({
            result: 'success',
            base_code: 'XOF',
            time_last_update_utc: 'Sat, 31 Oct 2026 00:00:00 +0000',
            rates: {
              EUR: 0.001524,
              USD: 0.001702,
              NGN: 2.289877,
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      return new Response('Not Found', { status: 404 });
    };

    const tool = new ConvertirDeviseTool(fakeFetch);
    const result = await tool.execute({ montant_fcfa: 12000, devise: 'eur' });

    expect(result).toEqual({
      montant_fcfa: 12000,
      devise: 'EUR',
      taux: 0.001524,
      montant_converti: 18.29, // 12000 * 0.001524 = 18.288 -> rounded to 18.29
      taux_mis_a_jour_le: 'Sat, 31 Oct 2026 00:00:00 +0000',
      source: 'exchangerate-api.com',
    });
  });

  it('XOF en HTTP 500 puis USD OK (taux croisé correct)', async () => {
    const fakeFetch: typeof fetch = async (input) => {
      const url = String(input);
      if (url.includes('/XOF')) {
        return new Response('Internal Server Error', { status: 500 });
      }
      if (url.includes('/USD')) {
        return new Response(
          JSON.stringify({
            result: 'success',
            base_code: 'USD',
            time_last_update_utc: 'Sat, 31 Oct 2026 00:00:00 +0000',
            rates: {
              XOF: 600,
              EUR: 0.9,
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      return new Response('Not Found', { status: 404 });
    };

    const tool = new ConvertirDeviseTool(fakeFetch);
    const result = await tool.execute({ montant_fcfa: 12000, devise: 'EUR' });

    expect(result.erreur).toBeUndefined();
    expect(result.devise).toBe('EUR');
    expect(result.montant_fcfa).toBe(12000);
    // rate = EUR / XOF = 0.9 / 600 = 0.0015
    expect(result.taux).toBe(0.0015);
    // 12000 * 0.0015 = 18
    expect(result.montant_converti).toBe(18);
    expect(result.taux_mis_a_jour_le).toBe('Sat, 31 Oct 2026 00:00:00 +0000');
  });

  it('XOF et USD en échec', async () => {
    const fakeFetch: typeof fetch = async () => {
      return new Response('Internal Server Error', { status: 500 });
    };

    const tool = new ConvertirDeviseTool(fakeFetch);
    const result = await tool.execute({ montant_fcfa: 12000, devise: 'EUR' });

    expect(result).toEqual({
      erreur: 'service de taux indisponible',
      conseil:
        'dire au client que la conversion est momentanément impossible ; ne JAMAIS estimer un taux',
    });
  });

  it('devise absente du résultat de taux', async () => {
    const fakeFetch: typeof fetch = async () => {
      return new Response(
        JSON.stringify({
          result: 'success',
          base_code: 'XOF',
          time_last_update_utc: 'Sat, 31 Oct 2026 00:00:00 +0000',
          rates: { EUR: 0.001524 },
        }),
        { status: 200 },
      );
    };

    const tool = new ConvertirDeviseTool(fakeFetch);
    const result = await tool.execute({ montant_fcfa: 5000, devise: 'XYZ' });

    expect(result).toEqual({
      erreur: 'devise non prise en charge',
      conseil: 'utiliser un code ISO à 3 lettres (EUR, USD, NGN...)',
    });
  });

  it('timeout produit "service de taux indisponible"', async () => {
    const fakeFetch: typeof fetch = async () => {
      const err = new Error('The operation was aborted');
      err.name = 'TimeoutError';
      throw err;
    };

    const tool = new ConvertirDeviseTool(fakeFetch);
    const result = await tool.execute({ montant_fcfa: 12000, devise: 'EUR' });

    expect(result).toEqual({
      erreur: 'service de taux indisponible',
      conseil:
        'dire au client que la conversion est momentanément impossible ; ne JAMAIS estimer un taux',
    });
  });

  it('date absente: si time_last_update_utc est absent, taux_mis_a_jour_le vaut null', async () => {
    const fakeFetch: typeof fetch = async () => {
      return new Response(
        JSON.stringify({
          result: 'success',
          base_code: 'XOF',
          // time_last_update_utc is absent
          rates: { EUR: 0.001524 },
        }),
        { status: 200 },
      );
    };

    const tool = new ConvertirDeviseTool(fakeFetch);
    const result = await tool.execute({ montant_fcfa: 12000, devise: 'EUR' });

    expect(result.erreur).toBeUndefined();
    expect(result.taux_mis_a_jour_le).toBeNull();
  });
});

describe('Tool - creer_commande', () => {
  it('registers order and returns full summary', async () => {
    const shop = new Shop();
    const tool = new CreerCommandeTool(shop);

    const result = await tool.execute({
      client_nom: 'Koffi Mensah',
      zone: 'Fidjrossè',
      articles: [{ ref: 'P01', quantite: 1 }],
    });

    expect(result).toEqual({
      numero_commande: 'CMD-1',
      client_nom: 'Koffi Mensah',
      zone: 'Fidjrossè',
      articles: [
        {
          ref: 'P01',
          nom: 'Pagne wax 6 yards',
          quantite: 1,
          prix_unitaire_fcfa: 12000,
          sous_total_fcfa: 12000,
        },
      ],
      frais_livraison_fcfa: 1500,
      total_fcfa: 13500,
    });
  });

  it('returns exact error on out of stock', async () => {
    const shop = new Shop();
    const tool = new CreerCommandeTool(shop);

    const result = await tool.execute({
      client_nom: 'Amina',
      zone: 'Cotonou',
      articles: [{ ref: 'P03', quantite: 1 }],
    });

    expect(result).toEqual({
      erreur: 'stock insuffisant pour Sac en raphia',
      stock_disponible: 0,
    });
  });

  it('returns exact error on unknown reference', async () => {
    const shop = new Shop();
    const tool = new CreerCommandeTool(shop);

    const result = await tool.execute({
      client_nom: 'Amina',
      zone: 'Cotonou',
      articles: [{ ref: 'P99', quantite: 1 }],
    });

    expect(result).toEqual({
      erreur: 'référence inconnue',
      conseil: 'utiliser chercher_produits pour trouver la bonne référence',
    });
  });

  it('returns exact error on unserviced zone', async () => {
    const shop = new Shop();
    const tool = new CreerCommandeTool(shop);

    const result = await tool.execute({
      client_nom: 'Amina',
      zone: 'Lomé',
      articles: [{ ref: 'P01', quantite: 1 }],
    });

    expect(result).toEqual({
      erreur: 'zone non desservie',
      zones_desservies: [...CANONICAL_ZONE_NAMES],
    });
  });
});
