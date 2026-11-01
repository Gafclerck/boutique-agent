import type { Shop } from '../domain/shop.js';
import type { ToolDefinition } from '../ports/llm-client.js';
import type { Tool } from './types.js';

export class VerifierStockTool implements Tool {
  public readonly name = 'verifier_stock';
  public readonly description =
    'Donne le stock disponible d\'une référence produit. À appeler avant de promettre un produit ou une quantité. Si le stock est 0, signaler la rupture et proposer une alternative du catalogue.';

  public readonly parameters = {
    type: 'object',
    properties: {
      ref: {
        type: 'string',
        description: 'Référence du produit (ex : P01)',
      },
    },
    required: ['ref'],
  };

  constructor(private readonly shop: Shop) {}

  public async execute(args: unknown): Promise<Record<string, unknown>> {
    if (
      typeof args !== 'object' ||
      args === null ||
      !('ref' in args) ||
      typeof (args as { ref: unknown }).ref !== 'string' ||
      (args as { ref: string }).ref.trim().length === 0
    ) {
      return {
        erreur: 'argument invalide',
        conseil: 'fournir une référence sous la forme {"ref": "P01"}',
      };
    }

    const ref = (args as { ref: string }).ref.trim();
    const result = await this.shop.checkStock(ref);

    if (!result) {
      return {
        erreur: 'référence inconnue',
        conseil: 'utiliser chercher_produits pour trouver la bonne référence',
      };
    }

    const payload: Record<string, unknown> = {
      ref: result.ref,
      nom: result.nom,
      categorie: result.categorie,
      stock: result.stock,
      disponible: result.disponible,
    };

    if (result.stock === 0) {
      payload.conseil =
        'article en rupture : chercher une alternative avec chercher_produits en utilisant la catégorie, puis vérifier son stock avec verifier_stock avant de la proposer';
    }

    return payload;
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
