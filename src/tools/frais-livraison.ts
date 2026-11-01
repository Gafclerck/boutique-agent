import { CANONICAL_ZONE_NAMES } from '../domain/catalogue.js';
import type { Shop } from '../domain/shop.js';
import type { ToolDefinition } from '../ports/llm-client.js';
import type { Tool } from './types.js';

export class FraisLivraisonTool implements Tool {
  public readonly name = 'frais_livraison';
  public readonly description =
    'Donne les frais de livraison (FCFA) et le délai pour une zone. À appeler dès que le client indique où il veut être livré ou demande le coût de livraison. Si la zone n\'est pas desservie, s\'excuser et proposer les zones desservies.';

  public readonly parameters = {
    type: 'object',
    properties: {
      zone: {
        type: 'string',
        description: 'Nom de la zone ou quartier de livraison (ex : Cotonou, Calavi)',
      },
    },
    required: ['zone'],
  };

  constructor(private readonly shop: Shop) {}

  public async execute(args: unknown): Promise<Record<string, unknown>> {
    if (
      typeof args !== 'object' ||
      args === null ||
      !('zone' in args) ||
      typeof (args as { zone: unknown }).zone !== 'string' ||
      (args as { zone: string }).zone.trim().length === 0
    ) {
      return {
        erreur: 'argument invalide',
        conseil: 'fournir une zone sous la forme {"zone": "nom_de_zone"}',
      };
    }

    const zoneInput = (args as { zone: string }).zone.trim();
    const zone = this.shop.getDeliveryZone(zoneInput);

    if (!zone) {
      return {
        erreur: 'zone non desservie',
        zones_desservies: [...CANONICAL_ZONE_NAMES],
      };
    }

    return {
      zone: zone.zone,
      frais_fcfa: zone.frais_fcfa,
      delai: zone.delai,
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
