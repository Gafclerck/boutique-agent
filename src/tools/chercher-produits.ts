import type { Shop } from '../domain/shop.js';
import type { ToolDefinition } from '../ports/llm-client.js';
import type { Tool } from './types.js';

export class ChercherProduitsTool implements Tool {
  public readonly name = 'chercher_produits';
  public readonly description =
    'Cherche des produits du catalogue par mot-clé. Le mot-clé peut être un produit (pagne, robe) ou une catégorie (tissu, vetement, accessoire, soin). Ne donne pas le stock : appeler verifier_stock ensuite pour chaque produit concerné.';

  public readonly parameters = {
    type: 'object',
    properties: {
      mot_cle: {
        type: 'string',
        description:
          'Le mot-clé peut être un produit (pagne, robe) ou une catégorie (tissu, vetement, accessoire, soin).',
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
      typeof (args as { mot_cle: unknown }).mot_cle !== 'string' ||
      (args as { mot_cle: string }).mot_cle.trim().length === 0
    ) {
      return {
        erreur: 'argument invalide',
        conseil: 'fournir un mot-clé sous la forme {"mot_cle": "nom_du_produit"}',
      };
    }

    const motCle = (args as { mot_cle: string }).mot_cle.trim();
    const results = this.shop.searchProducts(motCle);

    if (results.length === 0) {
      return {
        erreur: `aucun produit pour ${motCle}`,
        conseil: 'essayer un mot plus général (ex : pagne, robe, sac)',
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
