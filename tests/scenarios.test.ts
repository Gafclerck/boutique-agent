import { describe, expect, it } from 'vitest';
import { FakeLlm } from '../src/adapters/llm/fake-llm.js';
import { SYSTEM_INSTRUCTIONS } from '../src/agent/instructions.js';
import { runAgent } from '../src/agent/loop.js';
import { Shop } from '../src/domain/shop.js';
import type { ChatResponse } from '../src/ports/llm-client.js';
import { createDefaultRegistry } from '../src/tools/registry.js';
import {
  REASON_MESSAGES,
  scenarioA,
  scenarioC,
  scenarioK,
  scenarioS1,
  scenarioS2,
  scenarioS3,
} from '../eval/scenarios.js';
import { createRunner } from '../src/agent/runners.js';

function createMockRatesFetch(): typeof fetch {
  return (async () => {
    return new Response(
      JSON.stringify({
        result: 'success',
        base_code: 'XOF',
        rates: {
          EUR: 0.001524,
          USD: 0.001702,
          NGN: 2.5,
        },
        time_last_update_utc: 'Sun, 01 Nov 2026 00:00:00 +0000',
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  }) as unknown as typeof fetch;
}

function makeToolCallResponse(
  id: string,
  name: string,
  args: Record<string, unknown>,
): ChatResponse {
  return {
    message: {
      role: 'assistant',
      content: null,
      tool_calls: [
        {
          id,
          type: 'function',
          function: {
            name,
            arguments: JSON.stringify(args),
          },
        },
      ],
    },
    usage: { promptTokens: 100, completionTokens: 20 },
    model: 'fake-model',
  };
}

function makeTextResponse(content: string): ChatResponse {
  return {
    message: {
      role: 'assistant',
      content,
      tool_calls: undefined,
    },
    usage: { promptTokens: 150, completionTokens: 30 },
    model: 'fake-model',
  };
}

describe('Vérificateurs déterministes de scénarios', () => {
  describe('Scénario S1 : Recherche, conversion et conformité du montant', () => {
    it('valide une exécution conforme (chercher_produits -> verifier_stock -> convertir_devise)', async () => {
      const shop = new Shop();
      const tools = createDefaultRegistry(shop, createMockRatesFetch());

      const fakeLlm = new FakeLlm([
        makeToolCallResponse('c1', 'chercher_produits', { mot_cle: 'pagne' }),
        makeToolCallResponse('c2', 'verifier_stock', { ref: 'P01' }),
        makeToolCallResponse('c3', 'convertir_devise', { montant_fcfa: 12000, devise: 'EUR' }),
        makeTextResponse(
          'Le Pagne wax 6 yards est disponible à 12 000 FCFA, ce qui équivaut à 18,29 EUR.',
        ),
      ]);

      const result = await runAgent({
        llm: fakeLlm,
        tools,
        instructions: SYSTEM_INSTRUCTIONS,
        userMessage: scenarioS1.userMessage,
      });

      const check = scenarioS1.check(result);
      expect(check.ok).toBe(true);
      expect(check.reasons).toEqual([]);
    });

    it('détecte l\'échec réel : convertir_devise sans chercher_produits préalable', async () => {
      const shop = new Shop();
      const tools = createDefaultRegistry(shop, createMockRatesFetch());

      // L'agent convertit directement un montant sans avoir cherché le produit
      const fakeLlm = new FakeLlm([
        makeToolCallResponse('c1', 'convertir_devise', { montant_fcfa: 12000, devise: 'EUR' }),
        makeTextResponse('Cela fait 18,29 EUR pour votre soeur.'),
      ]);

      const result = await runAgent({
        llm: fakeLlm,
        tools,
        instructions: SYSTEM_INSTRUCTIONS,
        userMessage: scenarioS1.userMessage,
      });

      const check = scenarioS1.check(result);
      expect(check.ok).toBe(false);
      expect(check.reasons).toContain(REASON_MESSAGES.S1_NO_SEARCH);
    });

    it('détecte l\'échec lorsque le montant converti ne figure pas dans la réponse', async () => {
      const shop = new Shop();
      const tools = createDefaultRegistry(shop, createMockRatesFetch());

      const fakeLlm = new FakeLlm([
        makeToolCallResponse('c1', 'chercher_produits', { mot_cle: 'pagne' }),
        makeToolCallResponse('c2', 'convertir_devise', { montant_fcfa: 12000, devise: 'EUR' }),
        makeTextResponse('Le pagne coûte 12 000 FCFA mais je ne précise pas la devise demandée.'),
      ]);

      const result = await runAgent({
        llm: fakeLlm,
        tools,
        instructions: SYSTEM_INSTRUCTIONS,
        userMessage: scenarioS1.userMessage,
      });

      const check = scenarioS1.check(result);
      expect(check.ok).toBe(false);
      expect(check.reasons).toContain(REASON_MESSAGES.S1_AMOUNT_MISMATCH(18.29));
    });
  });

  describe('Scénario S2 : Livraison à Lomé (zone non desservie)', () => {
    it('valide une exécution conforme (frais_livraison appelé, refus poli et liste des zones)', async () => {
      const shop = new Shop();
      const tools = createDefaultRegistry(shop);

      const fakeLlm = new FakeLlm([
        makeToolCallResponse('c1', 'frais_livraison', { zone: 'Lomé' }),
        makeTextResponse(
          'Malheureusement, nous ne livrons pas à Lomé. Nous desservons Cotonou, Akpakpa, Calavi, Fidjrossè, Porto-Novo et Ouidah.',
        ),
      ]);

      const result = await runAgent({
        llm: fakeLlm,
        tools,
        instructions: SYSTEM_INSTRUCTIONS,
        userMessage: scenarioS2.userMessage,
      });

      const check = scenarioS2.check(result);
      expect(check.ok).toBe(true);
      expect(check.reasons).toEqual([]);
    });

    it('détecte l\'échec lorsque frais_livraison n\'est pas appelé', async () => {
      const shop = new Shop();
      const tools = createDefaultRegistry(shop);

      const fakeLlm = new FakeLlm([
        makeTextResponse('Désolé, Lomé est hors de notre portée.'),
      ]);

      const result = await runAgent({
        llm: fakeLlm,
        tools,
        instructions: SYSTEM_INSTRUCTIONS,
        userMessage: scenarioS2.userMessage,
      });

      const check = scenarioS2.check(result);
      expect(check.ok).toBe(false);
      expect(check.reasons).toContain(REASON_MESSAGES.S2_NO_SHIPPING);
    });
  });

  describe('Scénario S3 : Prix du sac en raphia, rupture et alternative', () => {
    it('valide une exécution conforme (P03 vérifié en rupture, P04 vérifié en alternative)', async () => {
      const shop = new Shop();
      const tools = createDefaultRegistry(shop);

      const fakeLlm = new FakeLlm([
        makeToolCallResponse('c1', 'chercher_produits', { mot_cle: 'sac raphia' }),
        makeToolCallResponse('c2', 'verifier_stock', { ref: 'P03' }),
        makeToolCallResponse('c3', 'chercher_produits', { mot_cle: 'accessoire' }),
        makeToolCallResponse('c4', 'verifier_stock', { ref: 'P04' }),
        makeTextResponse(
          'Le Sac en raphia est actuellement en rupture de stock. Je vous propose en alternative nos Sandales en cuir à 9 000 FCFA (8 en stock).',
        ),
      ]);

      const result = await runAgent({
        llm: fakeLlm,
        tools,
        instructions: SYSTEM_INSTRUCTIONS,
        userMessage: scenarioS3.userMessage,
      });

      const check = scenarioS3.check(result);
      expect(check.ok).toBe(true);
      expect(check.reasons).toEqual([]);
    });

    it('détecte l\'échec réel : S3 prix annoncé sans verifier_stock', async () => {
      const shop = new Shop();
      const tools = createDefaultRegistry(shop);

      // Le LLM trouve le produit via chercher_produits mais annonce le prix sans vérifier le stock
      const fakeLlm = new FakeLlm([
        makeToolCallResponse('c1', 'chercher_produits', { mot_cle: 'sac raphia' }),
        makeTextResponse('Le Sac en raphia coûte 7 500 FCFA. C\'est un superbe accessoire !'),
      ]);

      const result = await runAgent({
        llm: fakeLlm,
        tools,
        instructions: SYSTEM_INSTRUCTIONS,
        userMessage: scenarioS3.userMessage,
      });

      const check = scenarioS3.check(result);
      expect(check.ok).toBe(false);
      expect(check.reasons).toContain(REASON_MESSAGES.S3_NO_STOCK_P03);
      expect(check.reasons).toContain(REASON_MESSAGES.S3_NO_RUPTURE_ANNOUNCED);
    });

    it('détecte l\'échec réel : S3 rupture annoncée mais alternative non vérifiée', async () => {
      const shop = new Shop();
      const tools = createDefaultRegistry(shop);

      // Le LLM vérifie P03 et constate le stock 0, annonce la rupture mais ne vérifie aucune alternative
      const fakeLlm = new FakeLlm([
        makeToolCallResponse('c1', 'chercher_produits', { mot_cle: 'sac raphia' }),
        makeToolCallResponse('c2', 'verifier_stock', { ref: 'P03' }),
        makeTextResponse(
          'Le Sac en raphia est en rupture de stock. Quel autre article aimeriez-vous découvrir ?',
        ),
      ]);

      const result = await runAgent({
        llm: fakeLlm,
        tools,
        instructions: SYSTEM_INSTRUCTIONS,
        userMessage: scenarioS3.userMessage,
      });

      const check = scenarioS3.check(result);
      expect(check.ok).toBe(false);
      expect(check.reasons).toContain(REASON_MESSAGES.S3_NO_VERIFIED_ALTERNATIVE);
    });
  });

  describe('Scénario a : Demande de sacs avec recherche préalable', () => {
    it('valide une exécution conforme (chercher_produits appelé avant la réponse)', async () => {
      const shop = new Shop();
      const tools = createDefaultRegistry(shop);

      const fakeLlm = new FakeLlm([
        makeToolCallResponse('c1', 'chercher_produits', { mot_cle: 'sac' }),
        makeTextResponse('Oui, nous proposons le Sac en raphia à 7 500 FCFA.'),
      ]);

      const result = await runAgent({
        llm: fakeLlm,
        tools,
        instructions: SYSTEM_INSTRUCTIONS,
        userMessage: scenarioA.userMessage,
      });

      const check = scenarioA.check(result);
      expect(check.ok).toBe(true);
      expect(check.reasons).toEqual([]);
    });

    it('détecte l\'échec réel : réponse sans chercher_produits', async () => {
      const shop = new Shop();
      const tools = createDefaultRegistry(shop);

      // Le LLM répond par une clarification conversationnelle sans chercher
      const fakeLlm = new FakeLlm([
        makeTextResponse('Bonjour ! Quel genre de sac recherchez-vous en particulier ?'),
      ]);

      const result = await runAgent({
        llm: fakeLlm,
        tools,
        instructions: SYSTEM_INSTRUCTIONS,
        userMessage: scenarioA.userMessage,
      });

      const check = scenarioA.check(result);
      expect(check.ok).toBe(false);
      expect(check.reasons).toContain(REASON_MESSAGES.A_NO_SEARCH);
    });
  });

  describe('Scénario c : Prix de la robe en USD avec vérification de stock', () => {
    it('valide une exécution conforme (P05 vérifié puis conversion USD)', async () => {
      const shop = new Shop();
      const tools = createDefaultRegistry(shop, createMockRatesFetch());

      const fakeLlm = new FakeLlm([
        makeToolCallResponse('c1', 'chercher_produits', { mot_cle: 'robe' }),
        makeToolCallResponse('c2', 'verifier_stock', { ref: 'P05' }),
        makeToolCallResponse('c3', 'convertir_devise', { montant_fcfa: 22000, devise: 'USD' }),
        makeTextResponse(
          'La Robe en wax coûte 22 000 FCFA, soit 37,44 USD. Elle est disponible avec 5 pièces en stock.',
        ),
      ]);

      const result = await runAgent({
        llm: fakeLlm,
        tools,
        instructions: SYSTEM_INSTRUCTIONS,
        userMessage: scenarioC.userMessage,
      });

      const check = scenarioC.check(result);
      expect(check.ok).toBe(true);
      expect(check.reasons).toEqual([]);
    });

    it('détecte l\'échec réel : c sans verifier_stock sur la robe P05', async () => {
      const shop = new Shop();
      const tools = createDefaultRegistry(shop, createMockRatesFetch());

      // Le LLM convertit directement sans appeler verifier_stock
      const fakeLlm = new FakeLlm([
        makeToolCallResponse('c1', 'chercher_produits', { mot_cle: 'robe' }),
        makeToolCallResponse('c2', 'convertir_devise', { montant_fcfa: 22000, devise: 'USD' }),
        makeTextResponse('La Robe en wax est affichée à 22 000 FCFA, soit 37,44 USD.'),
      ]);

      const result = await runAgent({
        llm: fakeLlm,
        tools,
        instructions: SYSTEM_INSTRUCTIONS,
        userMessage: scenarioC.userMessage,
      });

      const check = scenarioC.check(result);
      expect(check.ok).toBe(false);
      expect(check.reasons).toContain(REASON_MESSAGES.C_NO_STOCK);
    });
  });

  describe('Scénario K : Koffi à Porto-Novo (karité et conversion NGN)', () => {
    it('valide une exécution conforme en mode agent seul scripté', async () => {
      const fakeLlmSingle = new FakeLlm([
        makeToolCallResponse('s1', 'chercher_produits', { mot_cle: 'beurre de karite' }),
        makeToolCallResponse('s2', 'verifier_stock', { ref: 'P06' }),
        makeToolCallResponse('s3', 'calculer_total', {
          articles: [{ ref: 'P06', quantite: 3 }],
          zone: 'Porto-Novo',
        }),
        makeToolCallResponse('s4', 'convertir_devise', { montant_fcfa: 13500, devise: 'NGN' }),
        makeTextResponse(
          'Bonjour Koffi ! Vos 3 pots de beurre de karité livrés à Porto-Novo coûtent 13 500 FCFA, ce qui fait 33 750 NGN.',
        ),
      ]);

      const runner = createRunner({
        mode: 'single',
        llm: fakeLlmSingle,
        shop: new Shop(),
        fetchFn: createMockRatesFetch(),
      });

      const result = await runner({ userMessage: scenarioK.userMessage });
      const check = scenarioK.check(result);
      expect(check.ok).toBe(true);
      expect(check.reasons).toEqual([]);
    });

    it('valide une exécution conforme en mode équipe scripté (trace imbriquée)', async () => {
      const fakeLlmTeam = new FakeLlm({
        gerant: [
          makeToolCallResponse('g1', 'demander_au_vendeur', {
            demande: 'Rechercher P06, stock et devis pour 3 pots à Porto-Novo',
          }),
          makeToolCallResponse('g2', 'demander_au_logisticien', {
            demande: 'Convertir 13 500 FCFA en NGN',
          }),
          makeToolCallResponse('g3', 'demander_au_redacteur', {
            faits: '3 pots P06 à Porto-Novo : 13 500 FCFA, soit 33 750 NGN',
          }),
          makeTextResponse(
            'Bonjour M. Koffi ! Vos 3 pots de Beurre de karité reviennent à 13 500 FCFA livrés à Porto-Novo, soit 33 750 NGN. Souhaitez-vous confirmer ?',
          ),
        ],
        vendeur: [
          makeToolCallResponse('v1', 'chercher_produits', { mot_cle: 'karite' }),
          makeToolCallResponse('v2', 'verifier_stock', { ref: 'P06' }),
          makeToolCallResponse('v3', 'calculer_total', {
            articles: [{ ref: 'P06', quantite: 3 }],
            zone: 'Porto-Novo',
          }),
          makeTextResponse('3 pots P06 : 10 500 FCFA + 3 000 FCFA livraison = 13 500 FCFA'),
        ],
        logisticien: [
          makeToolCallResponse('l1', 'convertir_devise', { montant_fcfa: 13500, devise: 'NGN' }),
          makeTextResponse('13 500 FCFA = 33 750 NGN'),
        ],
        redacteur: [
          makeTextResponse(
            'Bonjour M. Koffi ! Vos 3 pots de Beurre de karité reviennent à 13 500 FCFA livrés à Porto-Novo, soit 33 750 NGN.',
          ),
        ],
      });

      const runner = createRunner({
        mode: 'team',
        llm: fakeLlmTeam,
        shop: new Shop(),
        fetchFn: createMockRatesFetch(),
      });

      const result = await runner({ userMessage: scenarioK.userMessage });
      const check = scenarioK.check(result);
      expect(check.ok).toBe(true);
      expect(check.reasons).toEqual([]);
    });

    it('détecte l\'échec : conversion d\'un autre montant (ex: sous-total 10500 au lieu du total 13500)', async () => {
      const fakeLlmSingle = new FakeLlm([
        makeToolCallResponse('s1', 'calculer_total', {
          articles: [{ ref: 'P06', quantite: 3 }],
          zone: 'Porto-Novo',
        }),
        makeToolCallResponse('s2', 'convertir_devise', { montant_fcfa: 10500, devise: 'NGN' }),
        makeTextResponse('Le total est de 13 500 FCFA, soit 26 250 NGN pour les articles seuls.'),
      ]);

      const runner = createRunner({
        mode: 'single',
        llm: fakeLlmSingle,
        shop: new Shop(),
        fetchFn: createMockRatesFetch(),
        evaluate: null,
      });

      const result = await runner({ userMessage: scenarioK.userMessage });
      const check = scenarioK.check(result);
      expect(check.ok).toBe(false);
      expect(check.reasons).toContain(REASON_MESSAGES.K_CONVERT_WRONG_AMOUNT(13500, 10500));
    });

    it('détecte l\'échec : absence de conversion en NGN', async () => {
      const fakeLlmSingle = new FakeLlm([
        makeToolCallResponse('s1', 'calculer_total', {
          articles: [{ ref: 'P06', quantite: 3 }],
          zone: 'Porto-Novo',
        }),
        makeTextResponse('Vos 3 pots de beurre de karité coûtent 13 500 FCFA livrés à Porto-Novo.'),
      ]);

      const runner = createRunner({
        mode: 'single',
        llm: fakeLlmSingle,
        shop: new Shop(),
        fetchFn: createMockRatesFetch(),
        evaluate: null,
      });

      const result = await runner({ userMessage: scenarioK.userMessage });
      const check = scenarioK.check(result);
      expect(check.ok).toBe(false);
      expect(check.reasons).toContain(REASON_MESSAGES.K_NO_CONVERT);
    });

    it('détecte l\'échec : montant converti absent de la réponse finale', async () => {
      const fakeLlmSingle = new FakeLlm([
        makeToolCallResponse('s1', 'calculer_total', {
          articles: [{ ref: 'P06', quantite: 3 }],
          zone: 'Porto-Novo',
        }),
        makeToolCallResponse('s2', 'convertir_devise', { montant_fcfa: 13500, devise: 'NGN' }),
        makeTextResponse(
          'Vos 3 pots de beurre de karité livrés à Porto-Novo reviennent à un total de 13 500 FCFA.',
        ),
      ]);

      const runner = createRunner({
        mode: 'single',
        llm: fakeLlmSingle,
        shop: new Shop(),
        fetchFn: createMockRatesFetch(),
        evaluate: null,
      });

      const result = await runner({ userMessage: scenarioK.userMessage });
      const check = scenarioK.check(result);
      expect(check.ok).toBe(false);
      expect(check.reasons).toContain(REASON_MESSAGES.K_AMOUNT_MISMATCH(33750));
    });
  });
});
