import type { ToolDefinition } from '../ports/llm-client.js';
import type { Tool } from './types.js';

interface ExchangeRateApiResponse {
  readonly result?: string;
  readonly base_code?: string;
  readonly time_last_update_utc?: string;
  readonly rates?: Record<string, number>;
}

const ERROR_ARGUMENT_INVALIDE = {
  erreur: 'argument invalide',
  conseil:
    'fournir un montant_fcfa positif et un code devise (ex: {"montant_fcfa": 12000, "devise": "EUR"})',
} as const;

const ERROR_SERVICE_INDISPONIBLE = {
  erreur: 'service de taux indisponible',
  conseil:
    'dire au client que la conversion est momentanément impossible ; ne JAMAIS estimer un taux',
} as const;

const ERROR_DEVISE_NON_PRISE_EN_CHARGE = {
  erreur: 'devise non prise en charge',
  conseil: 'utiliser un code ISO à 3 lettres (EUR, USD, NGN...)',
} as const;

export class ConvertirDeviseTool implements Tool {
  public readonly name = 'convertir_devise';
  public readonly description =
    'Convertit un montant en FCFA vers une autre devise (EUR, USD, NGN...) avec le taux réel du moment. À appeler dès que le client veut un prix dans une autre devise, en passant un montant en FCFA qui provient déjà des outils (prix ou total). Ne jamais convertir de tête.';

  public readonly parameters = {
    type: 'object',
    properties: {
      montant_fcfa: {
        type: 'number',
        description: 'Montant en FCFA (> 0)',
      },
      devise: {
        type: 'string',
        description:
          'Code ISO 4217 de la devise cible à 3 lettres (insensible à la casse, ex: EUR, USD, NGN)',
      },
    },
    required: ['montant_fcfa', 'devise'],
  };

  private readonly fetchFn: typeof fetch;

  constructor(fetchFn: typeof fetch = globalThis.fetch) {
    this.fetchFn = fetchFn;
  }

  public async execute(args: unknown): Promise<Record<string, unknown>> {
    if (
      typeof args !== 'object' ||
      args === null ||
      !('montant_fcfa' in args) ||
      !('devise' in args)
    ) {
      return ERROR_ARGUMENT_INVALIDE;
    }

    const { montant_fcfa, devise } = args as {
      montant_fcfa: unknown;
      devise: unknown;
    };

    if (
      typeof montant_fcfa !== 'number' ||
      Number.isNaN(montant_fcfa) ||
      montant_fcfa <= 0 ||
      typeof devise !== 'string' ||
      devise.trim().length === 0
    ) {
      return ERROR_ARGUMENT_INVALIDE;
    }

    const targetCurrency = devise.trim().toUpperCase();

    try {
      // Step 1: Query XOF base endpoint at each call (no cache)
      const xofRes = await this.fetchRates('XOF');
      let rates: Record<string, number> | undefined;
      let lastUpdated: string | null = null;

      if (
        xofRes.success &&
        xofRes.data?.result === 'success' &&
        xofRes.data?.base_code === 'XOF' &&
        xofRes.data?.rates
      ) {
        rates = xofRes.data.rates;
        lastUpdated = xofRes.data.time_last_update_utc ?? null;
      } else {
        // Fallback: Use USD as base and calculate cross rate in code
        const usdRes = await this.fetchRates('USD');
        const usdRates = usdRes.data?.rates;
        const xofPerUsd = usdRates ? usdRates['XOF'] : undefined;
        if (
          usdRes.success &&
          usdRes.data?.result === 'success' &&
          usdRates &&
          typeof xofPerUsd === 'number' &&
          xofPerUsd > 0
        ) {
          rates = {};
          for (const [code, usdRate] of Object.entries(usdRates)) {
            if (typeof usdRate === 'number') {
              rates[code] = usdRate / xofPerUsd;
            }
          }
          lastUpdated = usdRes.data.time_last_update_utc ?? null;
        } else {
          return ERROR_SERVICE_INDISPONIBLE;
        }
      }

      if (!rates) {
        return ERROR_SERVICE_INDISPONIBLE;
      }

      const rate = rates[targetCurrency];
      if (typeof rate !== 'number' || Number.isNaN(rate) || rate <= 0) {
        return ERROR_DEVISE_NON_PRISE_EN_CHARGE;
      }

      const montantConverti = Math.round(montant_fcfa * rate * 100) / 100;

      return {
        montant_fcfa,
        devise: targetCurrency,
        taux: rate,
        montant_converti: montantConverti,
        taux_mis_a_jour_le: lastUpdated,
        source: 'exchangerate-api.com',
      };
    } catch {
      return ERROR_SERVICE_INDISPONIBLE;
    }
  }

  private async fetchRates(
    base: string,
  ): Promise<{ success: boolean; data?: ExchangeRateApiResponse }> {
    try {
      const response = await this.fetchFn(
        `https://open.er-api.com/v6/latest/${encodeURIComponent(base)}`,
        { signal: AbortSignal.timeout(5000) },
      );
      if (!response.ok) {
        return { success: false };
      }
      const data = (await response.json()) as ExchangeRateApiResponse;
      return { success: true, data };
    } catch {
      return { success: false };
    }
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
