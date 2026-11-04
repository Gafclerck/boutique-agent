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

  K_NO_TOTAL: "calculer_total n'a pas été appelé avec P06, quantité 3 et la zone Porto-Novo",
  K_NO_CONVERT: "convertir_devise n'a pas été appelé pour la devise NGN",
  K_CONVERT_WRONG_AMOUNT: (expected: number, actual?: number) =>
    `convertir_devise a été appelé avec un montant (${actual}) différent du total_fcfa (${expected}) calculé`,
  K_CONVERT_FAILED: "l'outil convertir_devise a renvoyé une erreur",
  K_AMOUNT_MISMATCH: (expected: number | string) =>
    `le montant converti (${expected}) ne correspond pas à la réponse`,
  K_NOT_ANSWERED: (actual: string) =>
    `l'exécution s'est terminée avec le statut "${actual}" au lieu de "answered"`,
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

function checkAmountInReply(reply: string, amount: number): boolean {
  const dotStr = amount.toString();
  const commaStr = dotStr.replace('.', ',');
  const dot2Str = amount.toFixed(2);
  const comma2Str = dot2Str.replace('.', ',');
  if (
    reply.includes(dotStr) ||
    reply.includes(commaStr) ||
    reply.includes(dot2Str) ||
    reply.includes(comma2Str)
  ) {
    return true;
  }
  // Formats avec séparateurs de milliers usuels
  const enFormatted = amount.toLocaleString('en-US'); // "33,750"
  const spaceFormatted = enFormatted.replace(/,/g, ' '); // "33 750"
  const nbspFormatted = enFormatted.replace(/,/g, '\u00a0');
  const narrowNbspFormatted = enFormatted.replace(/,/g, '\u202f');
  if (
    reply.includes(enFormatted) ||
    reply.includes(spaceFormatted) ||
    reply.includes(nbspFormatted) ||
    reply.includes(narrowNbspFormatted)
  ) {
    return true;
  }
  // Motif chiffres espacés (ex: "33 750")
  const digitsOnly = Math.floor(amount).toString();
  if (digitsOnly.length >= 4) {
    const spacedPattern = digitsOnly.split('').join('\\s*');
    if (new RegExp(spacedPattern).test(reply)) {
      return true;
    }
  }
  return false;
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
          const found = checkAmountInReply(result.reply, montant);
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

/**
 * Scénario K (Koffi) :
 * "Je suis Koffi à Porto-Novo. Combien me coûtent 3 pots de beurre de karité livrés, et ça fait combien en nairas ?"
 *
 * Critères :
 * (1) calculer_total appelé avec P06, quantité 3 et zone Porto-Novo
 * (2) convertir_devise appelé avec devise NGN et montant_fcfa égal au total_fcfa renvoyé par calculer_total dans le tour
 * (3) réponse contient le montant converti renvoyé par l'outil (formats numériques tolérants)
 * (4) stopReason vaut "answered"
 * Fonctionne sur la trace aplatie (agent seul ou équipe).
 */
export const scenarioK: Scenario = {
  id: 'K',
  description: 'Devis pour 3 pots de beurre de karité livrés à Porto-Novo et conversion en nairas',
  userMessage:
    'Je suis Koffi à Porto-Novo. Combien me coûtent 3 pots de beurre de karité livrés, et ça fait combien en nairas ?',
  check(result: AgentRunResult): ScenarioCheckResult {
    const reasons: string[] = [];
    const toolCalls = extractToolCalls(result);

    // (4) stopReason vaut "answered"
    if (result.stopReason !== 'answered') {
      reasons.push(REASON_MESSAGES.K_NOT_ANSWERED(result.stopReason));
    }

    // (1) calculer_total appelé avec P06, quantité 3 et la zone Porto-Novo
    let matchingTotalCall: ToolCallTraceEvent | undefined;
    let expectedTotalFcfa: number | undefined;

    for (const call of toolCalls) {
      if (call.name !== 'calculer_total') continue;
      const args = parseArguments(call.arguments);
      const zone = (args.zone ?? '').toString().trim().toLowerCase();
      const isPortoNovo = zone.includes('porto-novo') || zone.includes('portonovo');
      const articles = Array.isArray(args.articles) ? args.articles : [];
      const hasP06Quantite3 = articles.some((item) => {
        if (!item || typeof item !== 'object') return false;
        const ref = (item.ref ?? '').toString().trim().toUpperCase();
        const q = Number(item.quantite ?? item.quantity);
        return ref === 'P06' && q === 3;
      });

      if (isPortoNovo && hasP06Quantite3) {
        matchingTotalCall = call;
        const res = call.result ?? {};
        if (typeof res.total_fcfa === 'number') {
          expectedTotalFcfa = res.total_fcfa;
        }
        break;
      }
    }

    if (!matchingTotalCall) {
      reasons.push(REASON_MESSAGES.K_NO_TOTAL);
    }

    // (2) convertir_devise appelé avec devise NGN et un montant_fcfa égal au total_fcfa renvoyé par calculer_total dans le tour
    const convertCalls = toolCalls.filter((call) => call.name === 'convertir_devise');
    const ngnCalls = convertCalls.filter((call) => {
      const args = parseArguments(call.arguments);
      const dev = (args.devise ?? '').toString().trim().toUpperCase();
      return dev === 'NGN';
    });

    if (ngnCalls.length === 0) {
      reasons.push(REASON_MESSAGES.K_NO_CONVERT);
    } else {
      const matchingAmountCall = ngnCalls.find((call) => {
        const args = parseArguments(call.arguments);
        const montant = Number(args.montant_fcfa);
        return expectedTotalFcfa !== undefined && montant === expectedTotalFcfa;
      });

      if (!matchingAmountCall) {
        const actualAmount = Number(parseArguments(ngnCalls[0]?.arguments).montant_fcfa);
        reasons.push(
          REASON_MESSAGES.K_CONVERT_WRONG_AMOUNT(
            expectedTotalFcfa ?? 13500,
            Number.isNaN(actualAmount) ? undefined : actualAmount,
          ),
        );
      } else {
        const res = matchingAmountCall.result ?? {};
        if (typeof res.erreur === 'string') {
          reasons.push(REASON_MESSAGES.K_CONVERT_FAILED);
        } else {
          // (3) la réponse contient le montant converti renvoyé par l'outil (formats numériques tolérants)
          const montant = res.montant_converti;
          if (typeof montant === 'number') {
            const found = checkAmountInReply(result.reply, montant);
            if (!found) {
              reasons.push(REASON_MESSAGES.K_AMOUNT_MISMATCH(montant));
            }
          }
        }
      }
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
  scenarioK,
];

export const SCENARIOS_BY_ID: ReadonlyMap<string, Scenario> = new Map(
  SCENARIOS.map((s) => [s.id, s]),
);
