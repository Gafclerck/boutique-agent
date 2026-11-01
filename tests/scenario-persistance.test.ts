import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FakeApproval } from '../src/adapters/approval/fake-approval.js';
import { FakeLlm } from '../src/adapters/llm/fake-llm.js';
import { JsonFileStore } from '../src/adapters/store/json-file-store.js';
import { SYSTEM_INSTRUCTIONS } from '../src/agent/instructions.js';
import { runAgent } from '../src/agent/loop.js';
import { Shop } from '../src/domain/shop.js';
import type { ChatMessage, ChatResponse } from '../src/ports/llm-client.js';
import { createDefaultRegistry } from '../src/tools/registry.js';

describe('Scénario du sujet scripté avec Persistance et Approbation', () => {
  let tempDir: string;
  let dataFilePath: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(
      path.join(os.tmpdir(), 'boutique-scenario-persistance-'),
    );
    dataFilePath = path.join(tempDir, 'shop.json');
  });

  afterEach(() => {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  it('exécute le scénario complet : recherche, rupture sac, commande robes refusée puis approuvée, persistance JSON', async () => {
    const store = new JsonFileStore(dataFilePath);
    const shop = new Shop(store);
    const tools = createDefaultRegistry(shop);
    const approval = new FakeApproval();

    // Vérification de l'état initial
    expect((await shop.checkStock('P05'))?.stock).toBe(5); // 5 Robes en wax
    expect((await shop.checkStock('P03'))?.stock).toBe(0); // 0 Sac en raphia (rupture)

    // =========================================================================
    // ÉTAPE 1 : Le client énonce son besoin
    // "Je m'appelle Afi. Je veux 2 robes en wax et 1 sac en raphia, livrés à Calavi."
    // Le LLM recherche les produits, vérifie les stocks et calcule les frais de livraison.
    // =========================================================================
    const turn1Step1: ChatResponse = {
      message: {
        role: 'assistant',
        content: null,
        tool_calls: [
          {
            id: 'call_search_robe',
            type: 'function',
            function: {
              name: 'chercher_produits',
              arguments: JSON.stringify({ mot_cle: 'robe wax' }),
            },
          },
          {
            id: 'call_search_sac',
            type: 'function',
            function: {
              name: 'chercher_produits',
              arguments: JSON.stringify({ mot_cle: 'sac raphia' }),
            },
          },
        ],
      },
      usage: { promptTokens: 150, completionTokens: 40 },
      model: 'fake-model',
    };

    const turn1Step2: ChatResponse = {
      message: {
        role: 'assistant',
        content: null,
        tool_calls: [
          {
            id: 'call_stock_robe',
            type: 'function',
            function: {
              name: 'verifier_stock',
              arguments: JSON.stringify({ ref: 'P05' }),
            },
          },
          {
            id: 'call_stock_sac',
            type: 'function',
            function: {
              name: 'verifier_stock',
              arguments: JSON.stringify({ ref: 'P03' }),
            },
          },
          {
            id: 'call_livraison',
            type: 'function',
            function: {
              name: 'frais_livraison',
              arguments: JSON.stringify({ zone: 'Calavi' }),
            },
          },
        ],
      },
      usage: { promptTokens: 250, completionTokens: 60 },
      model: 'fake-model',
    };

    const turn1Step3: ChatResponse = {
      message: {
        role: 'assistant',
        content:
          'Bonjour Afi ! Nous avons bien la robe en wax (P05) disponible à 22 000 FCFA l’unité (5 en stock). En revanche, le sac en raphia (P03) est actuellement en rupture de stock. Pour 2 robes en wax livrées à Calavi, le total s’élève à 46 000 FCFA (44 000 FCFA d’articles + 2 000 FCFA de livraison). Confirmez-vous la commande pour les 2 robes ?',
        tool_calls: undefined,
      },
      usage: { promptTokens: 350, completionTokens: 80 },
      model: 'fake-model',
    };

    const fakeLlmTurn1 = new FakeLlm([turn1Step1, turn1Step2, turn1Step3]);

    const resultTurn1 = await runAgent({
      llm: fakeLlmTurn1,
      tools,
      instructions: SYSTEM_INSTRUCTIONS,
      userMessage:
        "Je m'appelle Afi. Je veux 2 robes en wax et 1 sac en raphia, livrés à Calavi.",
      approval,
    });

    expect(resultTurn1.stopReason).toBe('answered');
    expect(resultTurn1.reply).toContain('rupture');
    expect(resultTurn1.reply).toContain('46 000 FCFA');

    // Le stock n'a pas bougé
    expect((await shop.checkStock('P05'))?.stock).toBe(5);
    expect(await shop.getOrders()).toHaveLength(0);

    // Historique cumulé pour le tour suivant
    const history: ChatMessage[] = resultTurn1.messages.slice(1);

    // =========================================================================
    // ÉTAPE 2 : Première tentative de commande -> APPROBATION REFUSÉE
    // Le client confirme, le LLM appelle creer_commande.
    // L'approbation humaine répond NON.
    // =========================================================================
    approval.addDecision({
      approved: false,
      reason: 'Validation boutique refusée par la gérante',
    });

    const turn2Step1: ChatResponse = {
      message: {
        role: 'assistant',
        content: null,
        tool_calls: [
          {
            id: 'call_cmd_refusee',
            type: 'function',
            function: {
              name: 'creer_commande',
              arguments: JSON.stringify({
                client_nom: 'Afi',
                zone: 'Calavi',
                articles: [{ ref: 'P05', quantite: 2 }],
              }),
            },
          },
        ],
      },
      usage: { promptTokens: 400, completionTokens: 35 },
      model: 'fake-model',
    };

    const turn2Step2: ChatResponse = {
      message: {
        role: 'assistant',
        content:
          'Je suis désolée Afi, la boutique n’a pas validé votre commande pour le moment.',
        tool_calls: undefined,
      },
      usage: { promptTokens: 460, completionTokens: 25 },
      model: 'fake-model',
    };

    const fakeLlmTurn2 = new FakeLlm([turn2Step1, turn2Step2]);

    const resultTurn2 = await runAgent({
      llm: fakeLlmTurn2,
      tools,
      instructions: SYSTEM_INSTRUCTIONS,
      history,
      userMessage: 'Oui, je confirme la commande des 2 robes en wax pour Calavi.',
      approval,
    });

    // Vérifications du refus :
    // 1. Demande d'approbation reçue avec récapitulatif lisible produit par le code
    expect(approval.requests).toHaveLength(1);
    expect(approval.requests[0]?.toolName).toBe('creer_commande');
    expect(approval.requests[0]?.recapitulatif).toContain('Afi');
    expect(approval.requests[0]?.recapitulatif).toContain('Robe en wax');
    expect(approval.requests[0]?.recapitulatif).toContain('46 000 FCFA');

    // 2. Observation renvoyée au LLM
    const turn2ToolMsg = resultTurn2.messages.find(
      (m) => m.role === 'tool' && m.tool_call_id === 'call_cmd_refusee',
    );
    expect(turn2ToolMsg).toBeDefined();
    expect(JSON.parse(turn2ToolMsg!.content!)).toEqual({
      erreur: 'commande refusée par la boutique',
      conseil:
        "informer le client poliment que la commande n'a pas été validée ; ne pas la recréer sans nouvelle demande du client",
    });

    // 3. Stock robes inchangé à 5, aucune commande enregistrée
    expect((await shop.checkStock('P05'))?.stock).toBe(5);
    expect(await shop.getOrders()).toHaveLength(0);

    // Mettre à jour l'historique
    history.length = 0;
    history.push(...resultTurn2.messages.slice(1));

    // =========================================================================
    // ÉTAPE 3 : Seconde tentative de commande -> APPROBATION ACCORDÉE
    // Le client insiste, la gérante accepte.
    // Commande n°1 créée, total 46 000 FCFA, stock robes décrémenté à 3.
    // =========================================================================
    approval.addDecision({
      approved: true,
      reason: 'Validation boutique accordée',
    });

    const turn3Step1: ChatResponse = {
      message: {
        role: 'assistant',
        content: null,
        tool_calls: [
          {
            id: 'call_cmd_approuvee',
            type: 'function',
            function: {
              name: 'creer_commande',
              arguments: JSON.stringify({
                client_nom: 'Afi',
                zone: 'Calavi',
                articles: [{ ref: 'P05', quantite: 2 }],
              }),
            },
          },
        ],
      },
      usage: { promptTokens: 520, completionTokens: 35 },
      model: 'fake-model',
    };

    const turn3Step2: ChatResponse = {
      message: {
        role: 'assistant',
        content:
          'Bonne nouvelle Afi ! Votre commande n°1 a été validée par la boutique. Le montant total est de 46 000 FCFA pour vos 2 robes livrées à Calavi.',
        tool_calls: undefined,
      },
      usage: { promptTokens: 600, completionTokens: 35 },
      model: 'fake-model',
    };

    const fakeLlmTurn3 = new FakeLlm([turn3Step1, turn3Step2]);

    const resultTurn3 = await runAgent({
      llm: fakeLlmTurn3,
      tools,
      instructions: SYSTEM_INSTRUCTIONS,
      history,
      userMessage: 'Pouvez-vous réessayer de valider ma commande s’il vous plaît ?',
      approval,
    });

    // 1. Deuxième demande d'approbation enregistrée
    expect(approval.requests).toHaveLength(2);

    // 2. Observation de succès reçue par le LLM
    const turn3ToolMsg = resultTurn3.messages.find(
      (m) => m.role === 'tool' && m.tool_call_id === 'call_cmd_approuvee',
    );
    expect(turn3ToolMsg).toBeDefined();
    const confirmedData = JSON.parse(turn3ToolMsg!.content!);
    expect(confirmedData.numero_commande).toBe('CMD-1');
    expect(confirmedData.total_fcfa).toBe(46000);

    // 3. Stock robes décrémenté à 3
    const finalStockP05 = (await shop.checkStock('P05'))?.stock;
    expect(finalStockP05).toBe(3);

    // 4. Commande présente dans le magasin
    const allOrders = await shop.getOrders();
    expect(allOrders).toHaveLength(1);
    expect(allOrders[0]?.numero_commande).toBe('CMD-1');
    expect(allOrders[0]?.client_nom).toBe('Afi');
    expect(allOrders[0]?.total_fcfa).toBe(46000);

    // =========================================================================
    // VÉRIFICATION DU FICHIER JSON SUR DISQUE
    // =========================================================================
    expect(fs.existsSync(dataFilePath)).toBe(true);
    const persistedRaw = fs.readFileSync(dataFilePath, 'utf-8');
    const persistedJson = JSON.parse(persistedRaw);

    expect(persistedJson.stock['P05']).toBe(3);
    expect(persistedJson.commandes).toHaveLength(1);
    expect(persistedJson.commandes[0].numero_commande).toBe('CMD-1');
    expect(persistedJson.commandes[0].client_nom).toBe('Afi');
    expect(persistedJson.commandes[0].zone).toBe('Calavi');
    expect(persistedJson.commandes[0].total_fcfa).toBe(46000);
    expect(persistedJson.commandes[0].statut).toBe('confirmee');
    expect(persistedJson.commandes[0].date).toBeDefined();
    expect(persistedJson.prochain_numero).toBe(2);
  });
});
