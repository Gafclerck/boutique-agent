import type { OrderFailureReason, Shop } from '../domain/shop.js';
import type { ToolDefinition } from '../ports/llm-client.js';
import type { Tool } from './types.js';

function formatFailure(result: OrderFailureReason): Record<string, unknown> {
  switch (result.reason) {
    case 'UNSERVICED_ZONE':
      return {
        erreur: 'zone non desservie',
        zones_desservies: [...result.zones_desservies],
      };
    case 'UNKNOWN_REFERENCE':
      return {
        erreur: 'référence inconnue',
        conseil: 'utiliser chercher_produits pour trouver la bonne référence',
      };
    case 'INSUFFICIENT_STOCK':
      return {
        erreur: result.message,
        stock_disponible: result.stock_disponible,
      };
    case 'INVALID_INPUT':
      return {
        erreur: result.message,
        conseil: 'vérifier les informations transmises pour le calcul du total',
      };
  }
}

export class CalculerTotalTool implements Tool {
  public readonly name = 'calculer_total';
  public readonly description =
    "Calcule le total d'un devis ou d'un récapitulatif (articles + livraison) pour une zone, sans rien enregistrer. À appeler dès que le client demande un total, et avant de lui proposer de confirmer une commande. Ne jamais calculer un total de tête.";

  public readonly parameters = {
    type: 'object',
    properties: {
      zone: {
        type: 'string',
        description: 'Zone de livraison desservie (ex: Cotonou, Calavi, Porto-Novo)',
      },
      articles: {
        type: 'array',
        description: 'Liste des articles à inclure dans le calcul',
        items: {
          type: 'object',
          properties: {
            ref: {
              type: 'string',
              description: 'Référence produit (ex: P01)',
            },
            quantite: {
              type: 'integer',
              minimum: 1,
              description: 'Quantité souhaitée (entier >= 1)',
            },
          },
          required: ['ref', 'quantite'],
        },
      },
    },
    required: ['zone', 'articles'],
  };

  constructor(private readonly shop: Shop) {}

  public async execute(args: unknown): Promise<Record<string, unknown>> {
    if (
      typeof args !== 'object' ||
      args === null ||
      !('zone' in args) ||
      !('articles' in args)
    ) {
      return {
        erreur: 'argument invalide',
        conseil:
          'fournir zone et articles sous la forme {"zone": "...", "articles": [{"ref": "P01", "quantite": 1}]}',
      };
    }

    const { zone, articles } = args as {
      zone: unknown;
      articles: unknown;
    };

    if (
      typeof zone !== 'string' ||
      zone.trim().length === 0 ||
      !Array.isArray(articles) ||
      articles.length === 0
    ) {
      return {
        erreur: 'argument invalide',
        conseil:
          'vérifier que zone est une chaîne non vide et que articles contient au moins un élément',
      };
    }

    const parsedArticles: Array<{ ref: string; quantite: number }> = [];
    for (const item of articles) {
      if (
        typeof item !== 'object' ||
        item === null ||
        typeof (item as { ref?: unknown }).ref !== 'string' ||
        (item as { ref: string }).ref.trim().length === 0 ||
        typeof (item as { quantite?: unknown }).quantite !== 'number' ||
        !Number.isInteger((item as { quantite: number }).quantite) ||
        (item as { quantite: number }).quantite < 1
      ) {
        return {
          erreur: 'argument invalide',
          conseil:
            'chaque article doit avoir une référence (ref) et une quantité entière positive (quantite)',
        };
      }
      parsedArticles.push({
        ref: (item as { ref: string }).ref.trim(),
        quantite: (item as { quantite: number }).quantite,
      });
    }

    const preview = await this.shop.previewOrder({
      clientNom: 'Client Devis',
      zone: zone.trim(),
      articles: parsedArticles,
    });

    if (!preview.success) {
      return formatFailure(preview);
    }

    const sousTotalArticles = preview.preview.articles.reduce(
      (sum, item) => sum + item.sous_total_fcfa,
      0,
    );

    return {
      zone: preview.preview.zone,
      articles: preview.preview.articles.map((item) => ({
        ref: item.ref,
        nom: item.nom,
        quantite: item.quantite,
        prix_unitaire_fcfa: item.prix_unitaire_fcfa,
        sous_total_fcfa: item.sous_total_fcfa,
      })),
      sous_total_articles_fcfa: sousTotalArticles,
      frais_livraison_fcfa: preview.preview.frais_livraison_fcfa,
      total_fcfa: preview.preview.total_fcfa,
      delai: '24 à 48 h',
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
