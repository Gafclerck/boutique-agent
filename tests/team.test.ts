import { describe, expect, it } from 'vitest';
import { FakeApproval } from '../src/adapters/approval/fake-approval.js';
import { FakeLlm } from '../src/adapters/llm/fake-llm.js';
import { evaluateReply } from '../src/agent/evaluation/index.js';
import { createRunner } from '../src/agent/runners.js';
import {
  GERANT_INSTRUCTIONS,
  VENDEUR_INSTRUCTIONS,
} from '../src/agent/team/team-instructions.js';
import type { ToolCallTraceEvent } from '../src/agent/trace.js';
import { INITIAL_PRODUCTS } from '../src/domain/catalogue.js';
import { Shop } from '../src/domain/shop.js';
import { estimateCostRodi } from '../src/metrics/cost.js';
import { MODEL_PRICES } from '../src/metrics/model-prices.js';
import type { ChatMessage } from '../src/ports/llm-client.js';

describe('TACHE F : Tests gratuits de l\'équipe (FakeLlm par rôle)', () => {
  it('1. Contexte neuf : la première requête LLM d\'un spécialiste contient uniquement son system et la demande (aucun historique du Gérant)', async () => {
    const fakeLlm = new FakeLlm({
      gerant: [
        // Gérant Step 1 : appelle demander_au_vendeur
        {
          message: {
            role: 'assistant',
            content: null,
            tool_calls: [
              {
                id: 'call_vendeur',
                type: 'function',
                function: {
                  name: 'demander_au_vendeur',
                  arguments: JSON.stringify({ demande: 'Cherche pagne et stock' }),
                },
              },
            ],
          },
          usage: { promptTokens: 50, completionTokens: 15 },
          model: 'fake',
        },
        // Gérant Step 2 : réponse finale
        {
          message: { role: 'assistant', content: 'Le pagne est disponible.' },
          usage: { promptTokens: 60, completionTokens: 10 },
          model: 'fake',
        },
      ],
      vendeur: [
        // Vendeur Step 1 : réponse directe sans outils
        {
          message: { role: 'assistant', content: 'Pagne disponible en stock.' },
          usage: { promptTokens: 40, completionTokens: 10 },
          model: 'fake',
        },
      ],
    });

    const shop = new Shop();
    const runner = createRunner({
      mode: 'team',
      llm: fakeLlm,
      shop,
      evaluate: null,
    });

    // Historique riche côté Gérant
    const gerantHistory: ChatMessage[] = [
      { role: 'user', content: 'Bonjour Afi' },
      { role: 'assistant', content: 'Bonjour ! Comment vous aider ?' },
      { role: 'user', content: 'Je cherche un habit' },
      { role: 'assistant', content: 'Quel type d\'article souhaitez-vous ?' },
    ];

    await runner({
      userMessage: 'Avez-vous du pagne wax ?',
      history: gerantHistory,
    });

    // Inspecter la première requête adressée au vendeur
    const vendeurRequests = fakeLlm.requests.filter((r) => r.role === 'vendeur');
    expect(vendeurRequests.length).toBeGreaterThan(0);

    const firstVendeurReq = vendeurRequests[0]!;
    expect(firstVendeurReq.messages).toHaveLength(2);
    expect(firstVendeurReq.messages[0]).toEqual({
      role: 'system',
      content: VENDEUR_INSTRUCTIONS,
    });
    expect(firstVendeurReq.messages[1]).toEqual({
      role: 'user',
      content: 'Cherche pagne et stock',
    });

    // Aucun message de l'historique du gérant n'est présent
    const contents = firstVendeurReq.messages.map((m) => m.content);
    expect(contents).not.toContain('Bonjour Afi');
    expect(contents).not.toContain('Avez-vous du pagne wax ?');
  });

  it('2. Le Gérant ne voit que le résumé : message tool exactement {"resume": ...}, détails dans la trace', async () => {
    const fakeLlm = new FakeLlm({
      gerant: [
        {
          message: {
            role: 'assistant',
            content: null,
            tool_calls: [
              {
                id: 'call_vendeur_1',
                type: 'function',
                function: {
                  name: 'demander_au_vendeur',
                  arguments: JSON.stringify({ demande: 'Pagne wax stock' }),
                },
              },
            ],
          },
          usage: { promptTokens: 50, completionTokens: 10 },
          model: 'fake',
        },
        {
          message: { role: 'assistant', content: 'Pagne wax 6 yards dispo à 12 000 FCFA (14 en stock).' },
          usage: { promptTokens: 80, completionTokens: 15 },
          model: 'fake',
        },
      ],
      vendeur: [
        {
          message: {
            role: 'assistant',
            content: null,
            tool_calls: [
              {
                id: 'call_stock_p01',
                type: 'function',
                function: {
                  name: 'verifier_stock',
                  arguments: JSON.stringify({ ref: 'P01' }),
                },
              },
            ],
          },
          usage: { promptTokens: 30, completionTokens: 10 },
          model: 'fake',
        },
        {
          message: { role: 'assistant', content: 'Pagne wax 6 yards disponible : 14 pièces en stock.' },
          usage: { promptTokens: 40, completionTokens: 12 },
          model: 'fake',
        },
      ],
    });

    const shop = new Shop();
    const runner = createRunner({
      mode: 'team',
      llm: fakeLlm,
      shop,
      evaluate: null,
    });

    const result = await runner({ userMessage: 'Disponibilité du pagne ?' });

    // Le message tool reçu par le LLM du Gérant contient UNIQUEMENT le résumé
    const toolMsg = result.messages.find((m) => m.role === 'tool');
    expect(toolMsg).toBeDefined();
    expect(JSON.parse(toolMsg!.content!)).toEqual({
      resume: 'Pagne wax 6 yards disponible : 14 pièces en stock.',
    });

    // Les messages du Gérant ne contiennent pas les retours directs de verifier_stock
    const verifierStockMsg = result.messages.find(
      (m) => m.role === 'tool' && m.tool_call_id === 'call_stock_p01',
    );
    expect(verifierStockMsg).toBeUndefined();

    // Mais la trace aplatie contient l'appel imbriqué de verifier_stock
    const nestedEvent = result.trace.find(
      (e) => e.type === 'tool_call' && (e as ToolCallTraceEvent).name === 'verifier_stock',
    );
    expect(nestedEvent).toBeDefined();
    expect((nestedEvent as ToolCallTraceEvent).nested).toBe(true);
    expect((nestedEvent as ToolCallTraceEvent).agent).toBe('vendeur');
  });

  it('3. Évaluation sur trace aplatie : verifier_stock imbriqué conforme, sans verifier_stock violation et reprise', async () => {
    // 3a. Conforme avec verifier_stock imbriqué
    const fakeLlmConforme = new FakeLlm({
      gerant: [
        {
          message: {
            role: 'assistant',
            content: null,
            tool_calls: [
              {
                id: 'call_v',
                type: 'function',
                function: {
                  name: 'demander_au_vendeur',
                  arguments: JSON.stringify({ demande: 'Chercher et vérifier pagne' }),
                },
              },
            ],
          },
          usage: { promptTokens: 40, completionTokens: 10 },
          model: 'fake',
        },
        {
          message: {
            role: 'assistant',
            content: 'Le Pagne wax 6 yards est disponible à 12 000 FCFA avec 14 pièces en stock.',
          },
          usage: { promptTokens: 60, completionTokens: 20 },
          model: 'fake',
        },
      ],
      vendeur: [
        {
          message: {
            role: 'assistant',
            content: null,
            tool_calls: [
              {
                id: 'c_search',
                type: 'function',
                function: {
                  name: 'chercher_produits',
                  arguments: JSON.stringify({ mot_cle: 'pagne' }),
                },
              },
            ],
          },
          usage: { promptTokens: 30, completionTokens: 10 },
          model: 'fake',
        },
        {
          message: {
            role: 'assistant',
            content: null,
            tool_calls: [
              {
                id: 'c_stock',
                type: 'function',
                function: {
                  name: 'verifier_stock',
                  arguments: JSON.stringify({ ref: 'P01' }),
                },
              },
            ],
          },
          usage: { promptTokens: 40, completionTokens: 10 },
          model: 'fake',
        },
        {
          message: {
            role: 'assistant',
            content: 'Pagne wax 6 yards (P01) disponible à 12 000 FCFA, 14 en stock.',
          },
          usage: { promptTokens: 50, completionTokens: 15 },
          model: 'fake',
        },
      ],
    });

    const runnerConforme = createRunner({
      mode: 'team',
      llm: fakeLlmConforme,
      shop: new Shop(),
    });

    const resConforme = await runnerConforme({
      userMessage: 'Avez-vous du pagne wax ?',
    });
    expect(resConforme.stopReason).toBe('answered');
    expect(resConforme.lastViolations).toBeUndefined();

    // 3b. Sans verifier_stock imbriqué -> critique stockD_abord -> reprise et correction
    const fakeLlmReprise = new FakeLlm({
      gerant: [
        // Tour 1 étape 1 : demande au vendeur sans stock
        {
          message: {
            role: 'assistant',
            content: null,
            tool_calls: [
              {
                id: 'call_v_1',
                type: 'function',
                function: {
                  name: 'demander_au_vendeur',
                  arguments: JSON.stringify({ demande: 'Chercher pagne' }),
                },
              },
            ],
          },
          usage: { promptTokens: 40, completionTokens: 10 },
          model: 'fake',
        },
        // Tour 1 étape 2 : brouillon mentionnant le produit sans que le stock soit vérifié
        {
          message: {
            role: 'assistant',
            content: 'Le Pagne wax 6 yards est proposé à 12 000 FCFA.',
          },
          usage: { promptTokens: 50, completionTokens: 15 },
          model: 'fake',
        },
        // Tour 1 étape 3 (reprise suite à la critique qualité) : appelle le vendeur pour le stock
        {
          message: {
            role: 'assistant',
            content: null,
            tool_calls: [
              {
                id: 'call_v_2',
                type: 'function',
                function: {
                  name: 'demander_au_vendeur',
                  arguments: JSON.stringify({ demande: 'Vérifier le stock de P01' }),
                },
              },
            ],
          },
          usage: { promptTokens: 70, completionTokens: 10 },
          model: 'fake',
        },
        // Tour 1 étape 4 : réponse corrigée après vérification du stock
        {
          message: {
            role: 'assistant',
            content: 'Le Pagne wax 6 yards est disponible à 12 000 FCFA (14 pièces en stock).',
          },
          usage: { promptTokens: 90, completionTokens: 20 },
          model: 'fake',
        },
      ],
      vendeur: [
        // Premier appel vendeur : uniquement chercher_produits
        {
          message: {
            role: 'assistant',
            content: null,
            tool_calls: [
              {
                id: 'c_search_only',
                type: 'function',
                function: {
                  name: 'chercher_produits',
                  arguments: JSON.stringify({ mot_cle: 'pagne' }),
                },
              },
            ],
          },
          usage: { promptTokens: 30, completionTokens: 10 },
          model: 'fake',
        },
        {
          message: { role: 'assistant', content: 'Trouvé Pagne wax 6 yards P01 à 12 000 FCFA.' },
          usage: { promptTokens: 40, completionTokens: 10 },
          model: 'fake',
        },
        // Deuxième appel vendeur (reprise) : verifier_stock
        {
          message: {
            role: 'assistant',
            content: null,
            tool_calls: [
              {
                id: 'c_stock_fix',
                type: 'function',
                function: {
                  name: 'verifier_stock',
                  arguments: JSON.stringify({ ref: 'P01' }),
                },
              },
            ],
          },
          usage: { promptTokens: 35, completionTokens: 10 },
          model: 'fake',
        },
        {
          message: { role: 'assistant', content: 'Stock P01 vérifié : 14 en stock.' },
          usage: { promptTokens: 45, completionTokens: 10 },
          model: 'fake',
        },
      ],
    });

    const runnerReprise = createRunner({
      mode: 'team',
      llm: fakeLlmReprise,
      shop: new Shop(),
    });

    const resReprise = await runnerReprise({
      userMessage: 'Avez-vous du pagne wax ?',
    });

    expect(resReprise.stopReason).toBe('answered');
    expect(resReprise.evaluationRetries).toBe(1);
    expect(resReprise.reply).toContain('14 pièces en stock');
  });

  it('4. Approbation dans l\'équipe : creer_commande via le vendeur déclenche l\'approbation (refus puis accord)', async () => {
    // 4a. Refus de la directrice
    const fakeApprovalRefus = new FakeApproval([
      { approved: false, reason: 'Stock réservé en boutique' },
    ]);
    const shopRefus = new Shop();

    const fakeLlmRefus = new FakeLlm({
      gerant: [
        {
          message: {
            role: 'assistant',
            content: null,
            tool_calls: [
              {
                id: 'call_cmd_refus',
                type: 'function',
                function: {
                  name: 'demander_au_vendeur',
                  arguments: JSON.stringify({
                    demande: 'Enregistrer la commande confirmée : 1 pagne P01 pour Cotonou, client Koffi',
                  }),
                },
              },
            ],
          },
          usage: { promptTokens: 50, completionTokens: 20 },
          model: 'fake',
        },
        {
          message: {
            role: 'assistant',
            content: 'Désolé, votre commande n\'a pas pu être validée par la boutique.',
          },
          usage: { promptTokens: 60, completionTokens: 15 },
          model: 'fake',
        },
      ],
      vendeur: [
        {
          message: {
            role: 'assistant',
            content: null,
            tool_calls: [
              {
                id: 'call_create_order',
                type: 'function',
                function: {
                  name: 'creer_commande',
                  arguments: JSON.stringify({
                    client_nom: 'Koffi',
                    zone: 'Cotonou',
                    articles: [{ ref: 'P01', quantite: 1 }],
                  }),
                },
              },
            ],
          },
          usage: { promptTokens: 40, completionTokens: 15 },
          model: 'fake',
        },
        {
          message: {
            role: 'assistant',
            content: 'La commande n\'a pas été validée : refusée par la boutique.',
          },
          usage: { promptTokens: 50, completionTokens: 15 },
          model: 'fake',
        },
      ],
    });

    const runnerRefus = createRunner({
      mode: 'team',
      llm: fakeLlmRefus,
      shop: shopRefus,
      approval: fakeApprovalRefus,
    });

    const resRefus = await runnerRefus({ userMessage: 'Je confirme ma commande' });
    expect(resRefus.stopReason).toBe('answered');

    // Le stock de P01 est inchangé
    const stockP01ApresRefus = await shopRefus.checkStock('P01');
    expect(stockP01ApresRefus?.stock).toBe(14);

    // Événement d'approbation dans la trace avec decision false
    const approvalEvent = resRefus.trace.find((e) => e.type === 'approval');
    expect(approvalEvent).toBeDefined();
    expect((approvalEvent as { decision: boolean }).decision).toBe(false);

    // 4b. Approbation accordée
    const fakeApprovalAccord = new FakeApproval([{ approved: true }]);
    const shopAccord = new Shop();

    const fakeLlmAccord = new FakeLlm({
      gerant: [
        {
          message: {
            role: 'assistant',
            content: null,
            tool_calls: [
              {
                id: 'call_cmd_accord',
                type: 'function',
                function: {
                  name: 'demander_au_vendeur',
                  arguments: JSON.stringify({
                    demande: 'Enregistrer commande confirmée 1 P01 Cotonou Koffi',
                  }),
                },
              },
            ],
          },
          usage: { promptTokens: 50, completionTokens: 20 },
          model: 'fake',
        },
        {
          message: {
            role: 'assistant',
            content: 'Votre commande CMD-001 est validée !',
          },
          usage: { promptTokens: 60, completionTokens: 15 },
          model: 'fake',
        },
      ],
      vendeur: [
        {
          message: {
            role: 'assistant',
            content: null,
            tool_calls: [
              {
                id: 'call_create_order_2',
                type: 'function',
                function: {
                  name: 'creer_commande',
                  arguments: JSON.stringify({
                    client_nom: 'Koffi',
                    zone: 'Cotonou',
                    articles: [{ ref: 'P01', quantite: 1 }],
                  }),
                },
              },
            ],
          },
          usage: { promptTokens: 40, completionTokens: 15 },
          model: 'fake',
        },
        {
          message: {
            role: 'assistant',
            content: 'Commande enregistrée avec succès sous la référence CMD-001.',
          },
          usage: { promptTokens: 50, completionTokens: 15 },
          model: 'fake',
        },
      ],
    });

    const runnerAccord = createRunner({
      mode: 'team',
      llm: fakeLlmAccord,
      shop: shopAccord,
      approval: fakeApprovalAccord,
    });

    const resAccord = await runnerAccord({ userMessage: 'Je confirme ma commande' });
    expect(resAccord.stopReason).toBe('answered');

    // Le stock est décrémenté de 14 à 13
    const stockP01ApresAccord = await shopAccord.checkStock('P01');
    expect(stockP01ApresAccord?.stock).toBe(13);
  });

  it('5. Budget partagé : dépassement réparti entre Gérant et spécialistes -> stopReason "budget_exceeded"', async () => {
    // Plafond total fixé à 3 appels pour le tour
    const fakeLlm = new FakeLlm({
      gerant: [
        // Appel 1 (gérant) : délègue au vendeur
        {
          message: {
            role: 'assistant',
            content: null,
            tool_calls: [
              {
                id: 'c_v',
                type: 'function',
                function: {
                  name: 'demander_au_vendeur',
                  arguments: JSON.stringify({ demande: 'Chercher produits' }),
                },
              },
            ],
          },
          usage: { promptTokens: 30, completionTokens: 10 },
          model: 'fake',
        },
        // Appel 4 (gérant) : tentative de répondre
        {
          message: { role: 'assistant', content: 'Réponse' },
          usage: { promptTokens: 30, completionTokens: 5 },
          model: 'fake',
        },
      ],
      vendeur: [
        // Appel 2 (vendeur) : cherche produits
        {
          message: {
            role: 'assistant',
            content: null,
            tool_calls: [
              {
                id: 'c_search',
                type: 'function',
                function: {
                  name: 'chercher_produits',
                  arguments: JSON.stringify({ mot_cle: 'pagne' }),
                },
              },
            ],
          },
          usage: { promptTokens: 20, completionTokens: 10 },
          model: 'fake',
        },
        // Appel 3 (vendeur) : vérifie stock (atteint le budget de 3 appels)
        {
          message: {
            role: 'assistant',
            content: null,
            tool_calls: [
              {
                id: 'c_stock',
                type: 'function',
                function: {
                  name: 'verifier_stock',
                  arguments: JSON.stringify({ ref: 'P01' }),
                },
              },
            ],
          },
          usage: { promptTokens: 25, completionTokens: 10 },
          model: 'fake',
        },
        // Appel 4 (vendeur) : tentative -> déclenche BudgetExceededError
        {
          message: { role: 'assistant', content: 'Résumé vendeur' },
          usage: { promptTokens: 25, completionTokens: 10 },
          model: 'fake',
        },
      ],
    });

    const runner = createRunner({
      mode: 'team',
      llm: fakeLlm,
      shop: new Shop(),
      maxTotalLlmCalls: 3,
    });

    const res = await runner({ userMessage: 'Demande complexe' });
    expect(res.stopReason).toBe('budget_exceeded');
  });

  it('6. Échec d\'un spécialiste (réponse vide ou max_steps) -> observation d\'erreur, aucun plantage', async () => {
    const fakeLlm = new FakeLlm({
      gerant: [
        // Appel 1 : gérant délègue au vendeur
        {
          message: {
            role: 'assistant',
            content: null,
            tool_calls: [
              {
                id: 'call_fail',
                type: 'function',
                function: {
                  name: 'demander_au_vendeur',
                  arguments: JSON.stringify({ demande: 'Demande introuvable' }),
                },
              },
            ],
          },
          usage: { promptTokens: 40, completionTokens: 10 },
          model: 'fake',
        },
        // Appel 2 : gérant reçoit l'erreur et répond calmement au client
        {
          message: {
            role: 'assistant',
            content:
              'Je vous prie de m\'excuser, l\'information est momentanément indisponible.',
          },
          usage: { promptTokens: 60, completionTokens: 15 },
          model: 'fake',
        },
      ],
      vendeur: [
        // Le vendeur renvoie une réponse vide -> empty_reply
        {
          message: { role: 'assistant', content: '' },
          usage: { promptTokens: 20, completionTokens: 0 },
          model: 'fake',
        },
      ],
    });

    const runner = createRunner({
      mode: 'team',
      llm: fakeLlm,
      shop: new Shop(),
    });

    const res = await runner({ userMessage: 'Info article' });
    expect(res.stopReason).toBe('answered');
    expect(res.reply).toContain('momentanément indisponible');

    // Le message tool contient l'erreur et le conseil
    const toolMsg = res.messages.find((m) => m.role === 'tool');
    expect(toolMsg).toBeDefined();
    const parsed = JSON.parse(toolMsg!.content!);
    expect(parsed.erreur).toBe("vendeur n'a pas pu répondre");
    expect(parsed.conseil).toContain('reformuler la demande');
  });

  it('7. Scénario de Koffi scripté en équipe et version agent seul (comptes d\'appels LLM et coût)', async () => {
    const fakeFetch: typeof fetch = async () => {
      return new Response(
        JSON.stringify({
          result: 'success',
          base_code: 'XOF',
          rates: { NGN: 2.5 },
          time_last_update_utc: 'Wed, 04 Nov 2026 00:00:00 +0000',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    };

    const userMessage =
      'Je suis Koffi à Porto-Novo. Combien me coûtent 3 pots de beurre de karité livrés, et ça fait combien en nairas ?';

    // ==========================================
    // 7A. VERSION ÉQUIPE (MODE TEAM)
    // ==========================================
    const fakeLlmTeam = new FakeLlm({
      gerant: [
        // 1. Gérant sollicite le vendeur
        {
          message: {
            role: 'assistant',
            content: null,
            tool_calls: [
              {
                id: 'gerant_vendeur',
                type: 'function',
                function: {
                  name: 'demander_au_vendeur',
                  arguments: JSON.stringify({
                    demande:
                      'Rechercher le beurre de karité, vérifier le stock pour 3 pots et calculer le devis avec livraison à Porto-Novo',
                  }),
                },
              },
            ],
          },
          usage: { promptTokens: 80, completionTokens: 25 },
          model: 'fake',
        },
        // 2. Gérant sollicite le logisticien pour convertir 13 500 FCFA en NGN
        {
          message: {
            role: 'assistant',
            content: null,
            tool_calls: [
              {
                id: 'gerant_logisticien',
                type: 'function',
                function: {
                  name: 'demander_au_logisticien',
                  arguments: JSON.stringify({
                    demande: 'Convertir le montant de 13 500 FCFA en NGN',
                  }),
                },
              },
            ],
          },
          usage: { promptTokens: 110, completionTokens: 20 },
          model: 'fake',
        },
        // 3. Gérant sollicite le rédacteur avec tous les faits
        {
          message: {
            role: 'assistant',
            content: null,
            tool_calls: [
              {
                id: 'gerant_redacteur',
                type: 'function',
                function: {
                  name: 'demander_au_redacteur',
                  arguments: JSON.stringify({
                    faits:
                      'Client Koffi à Porto-Novo. 3 pots de Beurre de karité 500 g : 10 500 FCFA (stock 40). Livraison Porto-Novo : 3 000 FCFA. Total livré : 13 500 FCFA. Soit 33 750 NGN au taux de 2.5 au 2026-11-04.',
                  }),
                },
              },
            ],
          },
          usage: { promptTokens: 140, completionTokens: 35 },
          model: 'fake',
        },
        // 4. Gérant formule la réponse finale reçue du rédacteur
        {
          message: {
            role: 'assistant',
            content:
              'Bonjour M. Koffi ! Vos 3 pots de Beurre de karité 500 g reviennent à 10 500 FCFA plus 3 000 FCFA de livraison à Porto-Novo, soit un total de 13 500 FCFA. Cela équivaut à 33 750 NGN (taux 2.5). Souhaitez-vous confirmer votre commande ?',
          },
          usage: { promptTokens: 160, completionTokens: 40 },
          model: 'fake',
        },
      ],
      vendeur: [
        // Vendeur 1 : chercher_produits
        {
          message: {
            role: 'assistant',
            content: null,
            tool_calls: [
              {
                id: 'v_search',
                type: 'function',
                function: {
                  name: 'chercher_produits',
                  arguments: JSON.stringify({ mot_cle: 'beurre de karite' }),
                },
              },
            ],
          },
          usage: { promptTokens: 40, completionTokens: 15 },
          model: 'fake',
        },
        // Vendeur 2 : verifier_stock P06
        {
          message: {
            role: 'assistant',
            content: null,
            tool_calls: [
              {
                id: 'v_stock',
                type: 'function',
                function: {
                  name: 'verifier_stock',
                  arguments: JSON.stringify({ ref: 'P06' }),
                },
              },
            ],
          },
          usage: { promptTokens: 50, completionTokens: 10 },
          model: 'fake',
        },
        // Vendeur 3 : calculer_total 3 P06 + Porto-Novo
        {
          message: {
            role: 'assistant',
            content: null,
            tool_calls: [
              {
                id: 'v_total',
                type: 'function',
                function: {
                  name: 'calculer_total',
                  arguments: JSON.stringify({
                    articles: [{ ref: 'P06', quantite: 3 }],
                    zone: 'Porto-Novo',
                  }),
                },
              },
            ],
          },
          usage: { promptTokens: 60, completionTokens: 15 },
          model: 'fake',
        },
        // Vendeur 4 : résumé factuel complet
        {
          message: {
            role: 'assistant',
            content:
              '3 pots de Beurre de karité 500 g (ref P06, stock vérifié 40) : 10 500 FCFA. Livraison Porto-Novo : 3 000 FCFA. Total livré : 13 500 FCFA.',
          },
          usage: { promptTokens: 70, completionTokens: 25 },
          model: 'fake',
        },
      ],
      logisticien: [
        // Logisticien 1 : convertir_devise
        {
          message: {
            role: 'assistant',
            content: null,
            tool_calls: [
              {
                id: 'l_conv',
                type: 'function',
                function: {
                  name: 'convertir_devise',
                  arguments: JSON.stringify({ montant_fcfa: 13500, devise: 'NGN' }),
                },
              },
            ],
          },
          usage: { promptTokens: 40, completionTokens: 12 },
          model: 'fake',
        },
        // Logisticien 2 : résumé factuel
        {
          message: {
            role: 'assistant',
            content:
              'Conversion de 13 500 FCFA en NGN : 33 750 NGN au taux de 2.5 mis à jour le 2026-11-04.',
          },
          usage: { promptTokens: 50, completionTokens: 18 },
          model: 'fake',
        },
      ],
      redacteur: [
        // Rédacteur 1 : message WhatsApp court
        {
          message: {
            role: 'assistant',
            content:
              'Bonjour M. Koffi ! Vos 3 pots de Beurre de karité 500 g reviennent à 10 500 FCFA plus 3 000 FCFA de livraison à Porto-Novo, soit un total de 13 500 FCFA. Cela équivaut à 33 750 NGN (taux 2.5). Souhaitez-vous confirmer votre commande ?',
          },
          usage: { promptTokens: 80, completionTokens: 40 },
          model: 'fake',
        },
      ],
    });

    const runnerTeam = createRunner({
      mode: 'team',
      llm: fakeLlmTeam,
      shop: new Shop(),
      fetchFn: fakeFetch,
    });

    const resTeam = await runnerTeam({ userMessage });

    expect(resTeam.stopReason).toBe('answered');
    expect(resTeam.lastViolations).toBeUndefined();

    // Vérifie le nombre exact d'appels LLM pour l'équipe :
    // 4 (Gérant) + 4 (Vendeur) + 2 (Logisticien) + 1 (Rédacteur) = 11 appels LLM
    const teamLlmCalls = resTeam.llmCalls;
    expect(teamLlmCalls).toBe(11);

    // Vérifie evaluateReply ok sur la réponse finale
    const verdictTeam = evaluateReply({
      userMessage,
      reply: resTeam.reply,
      trace: resTeam.trace,
      catalogue: INITIAL_PRODUCTS,
    });
    expect(verdictTeam.ok).toBe(true);

    // Coût estimé en RODI
    const geminiPrice = MODEL_PRICES['google/gemini-2.5-flash']!;
    const teamCost = estimateCostRodi(resTeam.usage, geminiPrice);
    expect(teamCost.totalRodi).toBeGreaterThan(0);

    // ==========================================
    // 7B. VERSION AGENT SEUL (MODE SINGLE)
    // ==========================================
    const fakeLlmSingle = new FakeLlm([
      // 1. chercher_produits
      {
        message: {
          role: 'assistant',
          content: null,
          tool_calls: [
            {
              id: 's_search',
              type: 'function',
              function: {
                name: 'chercher_produits',
                arguments: JSON.stringify({ mot_cle: 'beurre de karite' }),
              },
            },
          ],
        },
        usage: { promptTokens: 60, completionTokens: 15 },
        model: 'fake',
      },
      // 2. verifier_stock
      {
        message: {
          role: 'assistant',
          content: null,
          tool_calls: [
            {
              id: 's_stock',
              type: 'function',
              function: {
                name: 'verifier_stock',
                arguments: JSON.stringify({ ref: 'P06' }),
              },
            },
          ],
        },
        usage: { promptTokens: 75, completionTokens: 10 },
        model: 'fake',
      },
      // 3. calculer_total
      {
        message: {
          role: 'assistant',
          content: null,
          tool_calls: [
            {
              id: 's_total',
              type: 'function',
              function: {
                name: 'calculer_total',
                arguments: JSON.stringify({
                  articles: [{ ref: 'P06', quantite: 3 }],
                  zone: 'Porto-Novo',
                }),
              },
            },
          ],
        },
        usage: { promptTokens: 90, completionTokens: 15 },
        model: 'fake',
      },
      // 4. convertir_devise
      {
        message: {
          role: 'assistant',
          content: null,
          tool_calls: [
            {
              id: 's_conv',
              type: 'function',
              function: {
                name: 'convertir_devise',
                arguments: JSON.stringify({ montant_fcfa: 13500, devise: 'NGN' }),
              },
            },
          ],
        },
        usage: { promptTokens: 110, completionTokens: 15 },
        model: 'fake',
      },
      // 5. Réponse finale directe
      {
        message: {
          role: 'assistant',
          content:
            'Bonjour M. Koffi ! Vos 3 pots de Beurre de karité 500 g reviennent à 10 500 FCFA plus 3 000 FCFA de livraison à Porto-Novo, soit un total de 13 500 FCFA. Cela équivaut à 33 750 NGN (taux 2.5). Souhaitez-vous confirmer votre commande ?',
        },
        usage: { promptTokens: 130, completionTokens: 40 },
        model: 'fake',
      },
    ]);

    const runnerSingle = createRunner({
      mode: 'single',
      llm: fakeLlmSingle,
      shop: new Shop(),
      fetchFn: fakeFetch,
    });

    const resSingle = await runnerSingle({ userMessage });

    expect(resSingle.stopReason).toBe('answered');
    expect(resSingle.lastViolations).toBeUndefined();

    // Vérifie le nombre exact d'appels LLM pour l'agent seul : 5 appels
    const singleLlmCalls = resSingle.llmCalls;
    expect(singleLlmCalls).toBe(5);

    const singleCost = estimateCostRodi(resSingle.usage, geminiPrice);
    expect(singleCost.totalRodi).toBeGreaterThan(0);

    // Comparaison scriptée : 11 appels en équipe vs 5 appels agent seul
    expect(teamLlmCalls).toBe(11);
    expect(singleLlmCalls).toBe(5);
  });

  it('8. Conversation à deux tours en équipe : "et en euros ?" avec priorToolNames fourni', async () => {
    const fakeFetch: typeof fetch = async () => {
      return new Response(
        JSON.stringify({
          result: 'success',
          base_code: 'XOF',
          rates: { EUR: 0.001524 },
          time_last_update_utc: 'Wed, 04 Nov 2026 00:00:00 +0000',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    };

    const fakeLlmTour1 = new FakeLlm({
      gerant: [
        {
          message: {
            role: 'assistant',
            content: null,
            tool_calls: [
              {
                id: 't1_v',
                type: 'function',
                function: {
                  name: 'demander_au_vendeur',
                  arguments: JSON.stringify({
                    demande: 'Pagne wax 6 yards avec livraison Cotonou',
                  }),
                },
              },
            ],
          },
          usage: { promptTokens: 40, completionTokens: 15 },
          model: 'fake',
        },
        {
          message: {
            role: 'assistant',
            content:
              'Le Pagne wax 6 yards coûte 12 000 FCFA plus 1 000 FCFA de livraison à Cotonou, soit un total de 13 000 FCFA.',
          },
          usage: { promptTokens: 60, completionTokens: 25 },
          model: 'fake',
        },
      ],
      vendeur: [
        {
          message: {
            role: 'assistant',
            content: null,
            tool_calls: [
              {
                id: 'v_s',
                type: 'function',
                function: {
                  name: 'chercher_produits',
                  arguments: JSON.stringify({ mot_cle: 'pagne' }),
                },
              },
            ],
          },
          usage: { promptTokens: 30, completionTokens: 10 },
          model: 'fake',
        },
        {
          message: {
            role: 'assistant',
            content: null,
            tool_calls: [
              {
                id: 'v_st',
                type: 'function',
                function: {
                  name: 'verifier_stock',
                  arguments: JSON.stringify({ ref: 'P01' }),
                },
              },
            ],
          },
          usage: { promptTokens: 40, completionTokens: 10 },
          model: 'fake',
        },
        {
          message: {
            role: 'assistant',
            content: null,
            tool_calls: [
              {
                id: 'v_tot',
                type: 'function',
                function: {
                  name: 'calculer_total',
                  arguments: JSON.stringify({
                    articles: [{ ref: 'P01', quantite: 1 }],
                    zone: 'Cotonou',
                  }),
                },
              },
            ],
          },
          usage: { promptTokens: 50, completionTokens: 15 },
          model: 'fake',
        },
        {
          message: {
            role: 'assistant',
            content:
              'Pagne wax 6 yards (P01, stock 14) : 12 000 FCFA. Livraison Cotonou : 1 000 FCFA. Total : 13 000 FCFA.',
          },
          usage: { promptTokens: 60, completionTokens: 20 },
          model: 'fake',
        },
      ],
    });

    const shop = new Shop();
    const runnerTour1 = createRunner({
      mode: 'team',
      llm: fakeLlmTour1,
      shop,
      fetchFn: fakeFetch,
    });

    const resTour1 = await runnerTour1({
      userMessage: 'Combien coûte le pagne wax avec livraison à Cotonou ?',
    });
    expect(resTour1.stopReason).toBe('answered');

    const sessionToolNames = new Set<string>();
    for (const name of resTour1.toolNames) {
      sessionToolNames.add(name);
    }
    expect(sessionToolNames.has('chercher_produits')).toBe(true);

    // Tour 2 : "Et en euros ?"
    const fakeLlmTour2 = new FakeLlm({
      gerant: [
        {
          message: {
            role: 'assistant',
            content: null,
            tool_calls: [
              {
                id: 't2_log',
                type: 'function',
                function: {
                  name: 'demander_au_logisticien',
                  arguments: JSON.stringify({ demande: 'Convertir 13 000 FCFA en EUR' }),
                },
              },
            ],
          },
          usage: { promptTokens: 50, completionTokens: 15 },
          model: 'fake',
        },
        {
          message: {
            role: 'assistant',
            content: 'Cela fait 19,81 EUR.',
          },
          usage: { promptTokens: 70, completionTokens: 10 },
          model: 'fake',
        },
      ],
      logisticien: [
        {
          message: {
            role: 'assistant',
            content: null,
            tool_calls: [
              {
                id: 'l_conv_eur',
                type: 'function',
                function: {
                  name: 'convertir_devise',
                  arguments: JSON.stringify({ montant_fcfa: 13000, devise: 'EUR' }),
                },
              },
            ],
          },
          usage: { promptTokens: 30, completionTokens: 10 },
          model: 'fake',
        },
        {
          message: {
            role: 'assistant',
            content: '13 000 FCFA équivaut à 19,81 EUR (taux 0.001524 au 2026-11-04).',
          },
          usage: { promptTokens: 40, completionTokens: 15 },
          model: 'fake',
        },
      ],
    });

    const runnerTour2 = createRunner({
      mode: 'team',
      llm: fakeLlmTour2,
      shop,
      fetchFn: fakeFetch,
    });

    const resTour2 = await runnerTour2({
      userMessage: 'Et en euros ?',
      history: resTour1.messages.slice(1),
      priorToolNames: sessionToolNames,
    });

    expect(resTour2.stopReason).toBe('answered');
    // Pas de violation de rechercheD_abord ni de conversionSurMontantDeOutil
    expect(resTour2.lastViolations).toBeUndefined();
  });

  it('9. Instructions du Gérant sans donnée de boutique (vérification de structure et exports)', () => {
    expect(GERANT_INSTRUCTIONS).toBeDefined();
    expect(GERANT_INSTRUCTIONS.length).toBeGreaterThan(100);
    expect(GERANT_INSTRUCTIONS).toContain('coordonnes');
    expect(GERANT_INSTRUCTIONS).not.toContain('pagne');
    expect(GERANT_INSTRUCTIONS).not.toContain('Cotonou');
  });
});
