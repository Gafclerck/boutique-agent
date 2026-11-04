import type {
  OrderFailureReason,
  OrderInput,
  OrderPreview,
  Shop,
} from '../domain/shop.js';
import type { ToolDefinition } from '../ports/llm-client.js';
import type { Tool, ToolApprovalPreparation } from './types.js';

export function formatOrderFailure(result: OrderFailureReason): Record<string, unknown> {
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

function formatPrice(amount: number): string {
  return amount.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}

function formatRecapitulatif(preview: OrderPreview): string {
  const articlesLines = preview.articles
    .map(
      (a) =>
        `  - ${a.nom} (${a.ref}) x ${a.quantite} : ${formatPrice(a.sous_total_fcfa)} FCFA`,
    )
    .join('\n');

  return [
    '=== Récapitulatif de la commande ===',
    `Client : ${preview.client_nom}`,
    `Articles :\n${articlesLines}`,
    `Zone de livraison : ${preview.zone}`,
    `Frais de livraison : ${formatPrice(preview.frais_livraison_fcfa)} FCFA`,
    `Total : ${formatPrice(preview.total_fcfa)} FCFA`,
    '====================================',
  ].join('\n');
}

export function parseOrderArguments(
  args: unknown,
):
  | { readonly success: true; readonly params: OrderInput }
  | { readonly success: false; readonly error: Record<string, unknown> } {
  if (
    typeof args !== 'object' ||
    args === null ||
    !('client_nom' in args) ||
    !('zone' in args) ||
    !('articles' in args)
  ) {
    return {
      success: false,
      error: {
        erreur: 'argument invalide',
        conseil:
          'fournir client_nom, zone et articles sous la forme {"client_nom": "...", "zone": "...", "articles": [{"ref": "P01", "quantite": 1}]}',
      },
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
      success: false,
      error: {
        erreur: 'argument invalide',
        conseil:
          'vérifier que client_nom et zone sont des chaînes non vides et que articles contient au moins un élément',
      },
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
        success: false,
        error: {
          erreur: 'argument invalide',
          conseil:
            'chaque article doit avoir une référence (ref) et une quantité entière positive (quantite)',
        },
      };
    }
    parsedArticles.push({
      ref: (item as { ref: string }).ref,
      quantite: (item as { quantite: number }).quantite,
    });
  }

  return {
    success: true,
    params: {
      clientNom: client_nom,
      client_nom: client_nom,
      zone,
      articles: parsedArticles,
    },
  };
}

export class CreerCommandeTool implements Tool {
  public readonly name = 'creer_commande';
  public readonly description =
    'Enregistre définitivement une commande (action IRREVERSIBLE : décrémente le stock). Requiert une validation préalable. À appeler UNIQUEMENT après confirmation explicite du client. Ne jamais l\'appeler pour un simple devis.';
  public readonly requiresApproval = true;

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

  public getShop(): Shop {
    return this.shop;
  }

  public parseArguments(args: unknown) {
    return parseOrderArguments(args);
  }

  public async prepareApproval(
    args: unknown,
  ): Promise<ToolApprovalPreparation> {
    const parsed = this.parseArguments(args);
    if (!parsed.success) {
      return { valid: false, errorResult: parsed.error };
    }

    const previewResult = await this.shop.previewOrder(parsed.params);
    if (!previewResult.success) {
      return {
        valid: false,
        errorResult: formatOrderFailure(previewResult),
      };
    }

    const recap = formatRecapitulatif(previewResult.preview);

    return {
      valid: true,
      request: {
        toolName: this.name,
        recapitulatif: recap,
        details: {
          client_nom: previewResult.preview.client_nom,
          zone: previewResult.preview.zone,
          articles: previewResult.preview.articles,
          frais_livraison_fcfa: previewResult.preview.frais_livraison_fcfa,
          total_fcfa: previewResult.preview.total_fcfa,
        },
      },
    };
  }

  public async execute(args: unknown): Promise<Record<string, unknown>> {
    const parsed = this.parseArguments(args);
    if (!parsed.success) {
      return parsed.error;
    }

    const result = await this.shop.placeOrder(parsed.params);
    if (!result.success) {
      return formatOrderFailure(result);
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
