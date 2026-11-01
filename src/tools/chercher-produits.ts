import { InvalidKeywordError, type Shop } from '../domain/shop.js';
import type { Product } from '../domain/catalogue.js';
import type { ToolDefinition } from '../ports/llm-client.js';
import type { Tool } from './types.js';

export class ChercherProduitsTool implements Tool {
  public readonly name = 'chercher_produits';
  public readonly description =
    "Cherche des produits du catalogue par mot-clé. Un ou deux mots suffisent (ex : pagne, sac raphia, robe wax). Si rien ne correspond, réessayer une fois avec un mot plus général ou une catégorie avant d'interroger le client. Ne donne pas le stock : appeler verifier_stock ensuite pour chaque produit concerné.";

  public readonly parameters = {
    type: 'object',
    properties: {
      mot_cle: {
        type: 'string',
        description:
          "Un ou deux mots suffisent (ex : pagne, sac raphia, robe wax). Si rien ne correspond, réessayer une fois avec un mot plus général ou une catégorie avant d'interroger le client.",
      },
    },
    required: ['mot_cle'],
  };

  constructor(private readonly shop: Shop) {}

  public async execute(args: unknown): Promise<Record<string, unknown>> {
    if (
      typeof args !== 'object' ||
      args === null ||
      !('mot_cle' in args) ||
      typeof (args as { mot_cle: unknown }).mot_cle !== 'string'
    ) {
      return {
        erreur: 'argument invalide',
        conseil: 'fournir un mot-clé sous la forme {"mot_cle": "nom_du_produit"}',
      };
    }

    const motCle = (args as { mot_cle: string }).mot_cle.trim();
    let results: Product[];

    try {
      results = this.shop.searchProducts(motCle);
    } catch (err) {
      if (
        err instanceof InvalidKeywordError ||
        (err instanceof Error && err.message === 'mot-clé invalide')
      ) {
        return {
          erreur: 'mot-clé invalide',
          conseil:
            'un ou deux mots suffisent (ex : pagne, sac raphia, robe wax) ou une catégorie (tissu, vetement, accessoire, soin)',
        };
      }
      throw err;
    }

    if (results.length === 0) {
      return {
        erreur: `aucun produit pour ${motCle}`,
        conseil:
          'essayer un mot plus général ou une catégorie (tissu, vetement, accessoire, soin)',
      };
    }

    return {
      produits: results.map((p) => ({
        ref: p.ref,
        nom: p.nom,
        categorie: p.categorie,
        prix_fcfa: p.prix_fcfa,
      })),
    };
  }

  public toDefinition(): ToolDefinition {
    return {
      type: 'function',
      function: {
        name: this.name,
        description: this.description,
        parameters: this.parameters,
      },
    };
  }
}
