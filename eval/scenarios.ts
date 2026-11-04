import type { AgentRunResult } from '../src/agent/loop.js';
import type { ToolCallTraceEvent } from '../src/agent/trace.js';

export interface ScenarioCheckResult {
  readonly ok: boolean;
  readonly reasons: readonly string[];
}

export interface Scenario {
  readonly id: string;
  readonly description: string;
  readonly userMessage: string;
  readonly check: (result: AgentRunResult) => ScenarioCheckResult;
}

export const REASON_MESSAGES = {
  S1_NO_SEARCH: "chercher_produits n'a pas été appelé",
  S1_NO_CONVERT: "convertir_devise n'a pas été appelé",
  S1_CONVERT_BEFORE_SEARCH: 'convertir_devise doit être appelé après chercher_produits',
  S1_CONVERT_FAILED: "l'outil convertir_devise a renvoyé une erreur",
  S1_AMOUNT_MISMATCH: (expected: number | string) =>
    `le montant converti (${expected}) ne correspond pas à la réponse`,

  S2_NO_SHIPPING: "frais_livraison n'a pas été appelé",
  S2_NOT_UNSERVED: 'frais_livraison doit signaler une zone non desservie pour Lomé',
  S2_NO_UNSERVED_MENTION: "la réponse doit indiquer que Lomé n'est pas desservie",
  S2_NO_ZONES_LISTED: 'la réponse doit lister les zones desservies',

  S3_NO_STOCK_P03: "verifier_stock n'a pas été appelé sur P03",
  S3_NO_RUPTURE_ANNOUNCED: "la rupture de stock n'a pas été annoncée dans la réponse",
  S3_NO_VERIFIED_ALTERNATIVE: "aucune alternative dont le stock a été vérifié n'a été proposée",
  S3_ALTERNATIVE_NOT_IN_REPLY: "l'alternative dont le stock a été vérifié n'apparaît pas dans la réponse",

  A_NO_SEARCH: "chercher_produits n'a pas été appelé avant la réponse finale",

  C_NO_STOCK: "verifier_stock n'a pas été appelé sur la référence concernée (P05)",
} as const;

function extractToolCalls(result: AgentRunResult): readonly ToolCallTraceEvent[] {
  return result.trace.filter((event): event is ToolCallTraceEvent => event.type === 'tool_call');
}

function parseArguments(raw: unknown): Record<string, unknown> {
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw);
    } catch {
      return {};
    }
  }
  if (typeof raw === 'object' && raw !== null) {
    return raw as Record<string, unknown>;
  }
  return {};
}

/**
 * Scénario 1 (S1) :
 * "Vous avez des pagnes ? Combien ça fait en euros pour ma soeur à Paris ?"
 *
 * Critères ajustés :
 * - chercher_produits appelé
 * - convertir_devise appelé après chercher_produits
 * - montant converti issu de l'outil présent dans la réponse
 * - l'ordre des autres outils (ex: verifier_stock) est libre
 */
export const scenarioS1: Scenario = {
  id: 'S1',
  description: 'Recherche de pagnes, conversion en EUR et montant conforme',
  userMessage: 'Vous avez des pagnes ? Combien ça fait en euros pour ma soeur à Paris ?',
  check(result: AgentRunResult): ScenarioCheckResult {
    const reasons: string[] = [];
    const toolCalls = extractToolCalls(result);

    const firstSearchIndex = toolCalls.findIndex((call) => call.name === 'chercher_produits');
    if (firstSearchIndex === -1) {
      reasons.push(REASON_MESSAGES.S1_NO_SEARCH);
    }

    const firstConvertIndex = toolCalls.findIndex((call) => call.name === 'convertir_devise');
    if (firstConvertIndex === -1) {
      reasons.push(REASON_MESSAGES.S1_NO_CONVERT);
    } else if (firstSearchIndex !== -1 && firstConvertIndex < firstSearchIndex) {
      reasons.push(REASON_MESSAGES.S1_CONVERT_BEFORE_SEARCH);
    }

    if (firstConvertIndex !== -1) {
      const convertCall = toolCalls[firstConvertIndex];
      const res = convertCall?.result;
      if (res && typeof res.erreur === 'string') {
        reasons.push(REASON_MESSAGES.S1_CONVERT_FAILED);
      } else {
        const montant = res?.montant_converti;
        if (typeof montant === 'number') {
          const dotStr = montant.toString();
          const commaStr = dotStr.replace('.', ',');
          const dot2Str = montant.toFixed(2);
          const comma2Str = dot2Str.replace('.', ',');
          const found =
            result.reply.includes(dotStr) ||
            result.reply.includes(commaStr) ||
            result.reply.includes(dot2Str) ||
            result.reply.includes(comma2Str);
          if (!found) {
            reasons.push(REASON_MESSAGES.S1_AMOUNT_MISMATCH(montant));
          }
        }
      }
    }

    return { ok: reasons.length === 0, reasons };
  },
};

/**
 * Scénario 2 (S2) :
 * "Livrez-moi à Lomé."
 *
 * Critères docs/mesures-palier-1.md :
 * - frais_livraison renvoie "zone non desservie"
 * - la réponse liste les zones de l'outil
 */
export const scenarioS2: Scenario = {
  id: 'S2',
  description: 'Livraison à Lomé (zone non desservie et restitution des zones)',
  userMessage: 'Livrez-moi à Lomé.',
  check(result: AgentRunResult): ScenarioCheckResult {
    const reasons: string[] = [];
    const toolCalls = extractToolCalls(result);

    const shippingCalls = toolCalls.filter((call) => call.name === 'frais_livraison');
    if (shippingCalls.length === 0) {
      reasons.push(REASON_MESSAGES.S2_NO_SHIPPING);
    } else {
      const unserved = shippingCalls.some(
        (c) => c.result && c.result.erreur === 'zone non desservie',
      );
      if (!unserved) {
        reasons.push(REASON_MESSAGES.S2_NOT_UNSERVED);
      }
    }

    const replyLower = result.reply.toLowerCase();
    const mentionsLomeUnserved =
      (replyLower.includes('lomé') || replyLower.includes('lome')) &&
      (replyLower.includes('non') ||
        replyLower.includes('pas') ||
        replyLower.includes('malheureusement') ||
        replyLower.includes('desserv'));
    if (!mentionsLomeUnserved) {
      reasons.push(REASON_MESSAGES.S2_NO_UNSERVED_MENTION);
    }

    const knownZones = ['cotonou', 'akpakpa', 'fidjrosse', 'fidjrossè', 'calavi', 'porto-novo', 'ouidah'];
    const matchedZones = knownZones.filter((zone) => replyLower.includes(zone));
    if (matchedZones.length < 2) {
      reasons.push(REASON_MESSAGES.S2_NO_ZONES_LISTED);
    }

    return { ok: reasons.length === 0, reasons };
  },
};

/**
 * Scénario 3 (S3) :
 * "C'est combien le sac en raphia ?"
 *
 * Critères ajustés :
 * - verifier_stock appelé sur P03
 * - rupture annoncée
 * - au moins une alternative proposée dont le stock a été vérifié par verifier_stock
 */
export const scenarioS3: Scenario = {
  id: 'S3',
  description: 'Prix du sac en raphia, rupture annoncée et alternative vérifiée',
  userMessage: "C'est combien le sac en raphia ?",
  check(result: AgentRunResult): ScenarioCheckResult {
    const reasons: string[] = [];
    const toolCalls = extractToolCalls(result);

    const stockCalls = toolCalls.filter((call) => call.name === 'verifier_stock');
    const p03Call = stockCalls.find((call) => {
      const args = parseArguments(call.arguments);
      return args.ref === 'P03';
    });
    if (!p03Call) {
      reasons.push(REASON_MESSAGES.S3_NO_STOCK_P03);
    }

    const replyLower = result.reply.toLowerCase();
    const ruptureKeywords = [
      'rupture',
      'epuise',
      'épuisé',
      'plus en stock',
      'pas en stock',
      'indisponible',
      'stock à 0',
      'stock de 0',
      '0 exemplaire',
      '0 en stock',
    ];
    const hasRupture = ruptureKeywords.some((w) => replyLower.includes(w));
    if (!hasRupture) {
      reasons.push(REASON_MESSAGES.S3_NO_RUPTURE_ANNOUNCED);
    }

    const alternativeCalls = stockCalls.filter((call) => {
      const args = parseArguments(call.arguments);
      return args.ref && args.ref !== 'P03';
    });

    if (alternativeCalls.length === 0) {
      reasons.push(REASON_MESSAGES.S3_NO_VERIFIED_ALTERNATIVE);
    } else {
      const foundInReply = alternativeCalls.some((call) => {
        const args = parseArguments(call.arguments);
        const ref = (args.ref as string) || '';
        const res = call.result ?? {};
        const nom = (res.nom as string) || '';
        if (ref && result.reply.includes(ref)) return true;
        if (nom && replyLower.includes(nom.toLowerCase())) return true;
        const words = nom
          .toLowerCase()
          .split(/[^a-z0-9à-ÿ]+/)
          .filter((w) => w.length > 3);
        return words.some((w) => replyLower.includes(w));
      });
      if (!foundInReply) {
        reasons.push(REASON_MESSAGES.S3_ALTERNATIVE_NOT_IN_REPLY);
      }
    }

    return { ok: reasons.length === 0, reasons };
  },
};

/**
 * Scénario a :
 * "Bonjour, vous avez des sacs ?"
 *
 * Critères ajustés :
 * - chercher_produits appelé avant la réponse finale
 */
export const scenarioA: Scenario = {
  id: 'a',
  description: 'Recherche de sacs avant la réponse finale',
  userMessage: 'Bonjour, vous avez des sacs ?',
  check(result: AgentRunResult): ScenarioCheckResult {
    const reasons: string[] = [];
    const toolCalls = extractToolCalls(result);

    const hasSearch = toolCalls.some((call) => call.name === 'chercher_produits');
    if (!hasSearch) {
      reasons.push(REASON_MESSAGES.A_NO_SEARCH);
    }

    return { ok: reasons.length === 0, reasons };
  },
};

/**
 * Scénario c :
 * "Combien coûte une robe en dollars ?"
 *
 * Critères ajustés :
 * - verifier_stock appelé sur la référence concernée (P05)
 */
export const scenarioC: Scenario = {
  id: 'c',
  description: 'Vérification du stock de la robe (P05) avant réponse chiffrée',
  userMessage: 'Combien coûte une robe en dollars ?',
  check(result: AgentRunResult): ScenarioCheckResult {
    const reasons: string[] = [];
    const toolCalls = extractToolCalls(result);

    const stockCalls = toolCalls.filter((call) => call.name === 'verifier_stock');
    const p05Call = stockCalls.find((call) => {
      const args = parseArguments(call.arguments);
      return args.ref === 'P05';
    });
    if (!p05Call) {
      reasons.push(REASON_MESSAGES.C_NO_STOCK);
    }

    return { ok: reasons.length === 0, reasons };
  },
};

export const SCENARIOS: readonly Scenario[] = [
  scenarioS1,
  scenarioS2,
  scenarioS3,
  scenarioA,
  scenarioC,
];

export const SCENARIOS_BY_ID: ReadonlyMap<string, Scenario> = new Map(
  SCENARIOS.map((s) => [s.id, s]),
);
