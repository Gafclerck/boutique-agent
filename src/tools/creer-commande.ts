import type { Shop } from '../domain/shop.js';
import type { ToolDefinition } from '../ports/llm-client.js';
import type { Tool } from './types.js';

/**
 * PALIER 1 DESIGN NOTE:
 * In Palier 1, human validation by Afi is deliberately omitted (planned for Palier 2).
 * The order is directly registered and stock decremented once the client explicitly confirms.
 */
export class CreerCommandeTool implements Tool {
  public readonly name = 'creer_commande';
  public readonly description =
    'Enregistre définitivement une commande (action IRREVERSIBLE : décrémente le stock). À appeler UNIQUEMENT après que le client a confirmé explicitement un récapitulatif complet (articles, quantités, zone, total). Ne jamais l\'appeler pour un simple devis.';

  public readonly parameters = {
    type: 'object',
    properties: {
      client_nom: {
        type: 'string',
        description: 'Nom complet du client',
      },
      zone: {
        type: 'string',
        description: 'Zone de livraison desservie (ex: Cotonou, Calavi)',
      },
      articles: {
        type: 'array',
        description: 'Liste des articles à commander',
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
    required: ['client_nom', 'zone', 'articles'],
  };

  constructor(private readonly shop: Shop) {}

  public async execute(args: unknown): Promise<Record<string, unknown>> {
    if (
      typeof args !== 'object' ||
      args === null ||
      !('client_nom' in args) ||
      !('zone' in args) ||
      !('articles' in args)
    ) {
      return {
        erreur: 'argument invalide',
        conseil:
          'fournir client_nom, zone et articles sous la forme {"client_nom": "...", "zone": "...", "articles": [{"ref": "P01", "quantite": 1}]}',
      };
    }

    const { client_nom, zone, articles } = args as {
      client_nom: unknown;
      zone: unknown;
      articles: unknown;
    };

    if (
      typeof client_nom !== 'string' ||
      client_nom.trim().length === 0 ||
      typeof zone !== 'string' ||
      zone.trim().length === 0 ||
      !Array.isArray(articles) ||
      articles.length === 0
    ) {
      return {
        erreur: 'argument invalide',
        conseil:
          'vérifier que client_nom et zone sont des chaînes non vides et que articles contient au moins un élément',
      };
    }

    const parsedArticles: Array<{ ref: string; quantite: number }> = [];
    for (const item of articles) {
      if (
        typeof item !== 'object' ||
        item === null ||
        typeof (item as { ref?: unknown }).ref !== 'string' ||
        typeof (item as { quantite?: unknown }).quantite !== 'number'
      ) {
        return {
          erreur: 'argument invalide',
          conseil:
            'chaque article doit avoir une référence (ref) et une quantité entière positive (quantite)',
        };
      }
      parsedArticles.push({
        ref: (item as { ref: string }).ref,
        quantite: (item as { quantite: number }).quantite,
      });
    }

    const result = this.shop.createOrder({
      clientNom: client_nom,
      zone,
      articles: parsedArticles,
    });

    if (!result.success) {
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
            conseil: 'vérifier les informations transmises pour la commande',
          };
      }
    }

    const order = result.order;
    return {
      numero_commande: order.numero_commande,
      client_nom: order.client_nom,
      zone: order.zone,
      articles: order.articles.map((a) => ({
        ref: a.ref,
        nom: a.nom,
        quantite: a.quantite,
        prix_unitaire_fcfa: a.prix_unitaire_fcfa,
        sous_total_fcfa: a.sous_total_fcfa,
      })),
      frais_livraison_fcfa: order.frais_livraison_fcfa,
      total_fcfa: order.total_fcfa,
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
