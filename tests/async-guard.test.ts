import { describe, expect, it } from 'vitest';
import { FakeLlm } from '../src/adapters/llm/fake-llm.js';
import { FakeApproval } from '../src/adapters/approval/fake-approval.js';
import { runAgent } from '../src/agent/loop.js';
import { SYSTEM_INSTRUCTIONS } from '../src/agent/instructions.js';
import { Shop } from '../src/domain/shop.js';
import { createDefaultRegistry } from '../src/tools/registry.js';
import type { ConversationContext } from '../src/agent/conversation-context.js';
import type { ChatResponse } from '../src/ports/llm-client.js';

function createDummyUsage() {
  return { promptTokens: 10, completionTokens: 10, totalTokens: 20 };
}

describe('Garde de creer_commande en mode asynchrone', () => {
  it('refuse si lastQuote est absent (aucun devis préalable)', async () => {
    const shop = new Shop();
    const tools = createDefaultRegistry(shop);

    const responses: ChatResponse[] = [
      {
        message: {
          role: 'assistant',
          content: null,
          tool_calls: [
            {
              id: 'call-1',
              type: 'function',
              function: {
                name: 'creer_commande',
                arguments: JSON.stringify({
                  client_nom: 'Afi',
                  zone: 'Calavi',
                  articles: [{ ref: 'P05', quantite: 1 }],
                }),
              },
            },
          ],
        },
        usage: createDummyUsage(),
        model: 'fake-model',
      },
      {
        message: {
          role: 'assistant',
          content: 'Veuillez patienter pendant que nous préparons votre devis.',
        },
        usage: createDummyUsage(),
        model: 'fake-model',
      },
    ];

    const llm = new FakeLlm(responses);
    const conversation: ConversationContext = {
      chatId: 'chat-001',
      turnId: 1,
      lastClientMessage: 'oui je confirme',
    };

    const result = await runAgent({
      llm,
      tools,
      instructions: SYSTEM_INSTRUCTIONS,
      userMessage: 'oui je confirme',
      orderStrategy: 'async',
      conversation,
      shop,
    });

    // Aucune commande soumise
    expect(result.submittedOrders).toEqual([]);
    const allOrders = await shop.getOrders();
    expect(allOrders).toHaveLength(0);

    // Vérifie que l'observation renvoyée au LLM contient l'erreur de confirmation requise
    const toolMsg = result.messages.find((m) => m.role === 'tool');
    expect(toolMsg).toBeDefined();
    const toolContent = JSON.parse(toolMsg!.content!);
    expect(toolContent.erreur).toBe('confirmation requise');
    expect(toolContent.detail).toContain('aucun devis préalable');
  });

  it('refuse si devis et confirmation sont dans le MÊME tour (lastQuote.turnId >= turnId)', async () => {
    const shop = new Shop();
    const tools = createDefaultRegistry(shop);

    const responses: ChatResponse[] = [
      {
        message: {
          role: 'assistant',
          content: null,
          tool_calls: [
            {
              id: 'call-1',
              type: 'function',
              function: {
                name: 'creer_commande',
                arguments: JSON.stringify({
                  client_nom: 'Koffi',
                  zone: 'Calavi',
                  articles: [{ ref: 'P05', quantite: 1 }],
                }),
              },
            },
          ],
        },
        usage: createDummyUsage(),
        model: 'fake-model',
      },
      {
        message: {
          role: 'assistant',
          content: 'Confirmation en attente.',
        },
        usage: createDummyUsage(),
        model: 'fake-model',
      },
    ];

    const llm = new FakeLlm(responses);
    const conversation: ConversationContext = {
      chatId: 'chat-001',
      turnId: 1,
      lastClientMessage: 'oui je confirme',
      lastQuote: {
        zone: 'Calavi',
        lignes: [{ ref: 'P05', quantite: 1 }],
        total_fcfa: 24000,
        turnId: 1, // même tour que turnId !
      },
    };

    const result = await runAgent({
      llm,
      tools,
      instructions: SYSTEM_INSTRUCTIONS,
      userMessage: 'oui je confirme',
      orderStrategy: 'async',
      conversation,
      shop,
    });

    expect(result.submittedOrders).toEqual([]);
    const toolMsg = result.messages.find((m) => m.role === 'tool');
    const toolContent = JSON.parse(toolMsg!.content!);
    expect(toolContent.erreur).toBe('confirmation requise');
    expect(toolContent.detail).toContain('tours distincts');
  });

  it('refuse si lastClientMessage n est pas un accord explicite', async () => {
    const shop = new Shop();
    const tools = createDefaultRegistry(shop);

    const responses: ChatResponse[] = [
      {
        message: {
          role: 'assistant',
          content: null,
          tool_calls: [
            {
              id: 'call-1',
              type: 'function',
              function: {
                name: 'creer_commande',
                arguments: JSON.stringify({
                  client_nom: 'Koffi',
                  zone: 'Calavi',
                  articles: [{ ref: 'P05', quantite: 1 }],
                }),
              },
            },
          ],
        },
        usage: createDummyUsage(),
        model: 'fake-model',
      },
      {
        message: {
          role: 'assistant',
          content: 'Pas encore validé.',
        },
        usage: createDummyUsage(),
        model: 'fake-model',
      },
    ];

    const llm = new FakeLlm(responses);
    const conversation: ConversationContext = {
      chatId: 'chat-001',
      turnId: 2,
      lastClientMessage: 'oui mais 3 robes', // non explicite (chiffre + mot hors liste)
      lastQuote: {
        zone: 'Calavi',
        lignes: [{ ref: 'P05', quantite: 1 }],
        total_fcfa: 24000,
        turnId: 1,
      },
    };

    const result = await runAgent({
      llm,
      tools,
      instructions: SYSTEM_INSTRUCTIONS,
      userMessage: 'oui mais 3 robes',
      orderStrategy: 'async',
      conversation,
      shop,
    });

    expect(result.submittedOrders).toEqual([]);
    const toolMsg = result.messages.find((m) => m.role === 'tool');
    const toolContent = JSON.parse(toolMsg!.content!);
    expect(toolContent.erreur).toBe('confirmation requise');
    expect(toolContent.detail).toContain('accord explicite');
  });

  it('refuse si les arguments (zone ou multiensemble) diffèrent du dernier devis', async () => {
    const shop = new Shop();
    const tools = createDefaultRegistry(shop);

    const responses: ChatResponse[] = [
      {
        message: {
          role: 'assistant',
          content: null,
          tool_calls: [
            {
              id: 'call-1',
              type: 'function',
              function: {
                name: 'creer_commande',
                arguments: JSON.stringify({
                  client_nom: 'Koffi',
                  zone: 'Cotonou', // au lieu de Calavi !
                  articles: [{ ref: 'P05', quantite: 1 }],
                }),
              },
            },
          ],
        },
        usage: createDummyUsage(),
        model: 'fake-model',
      },
      {
        message: {
          role: 'assistant',
          content: 'Zone incohérente.',
        },
        usage: createDummyUsage(),
        model: 'fake-model',
      },
    ];

    const llm = new FakeLlm(responses);
    const conversation: ConversationContext = {
      chatId: 'chat-001',
      turnId: 2,
      lastClientMessage: 'oui je confirme',
      lastQuote: {
        zone: 'Calavi',
        lignes: [{ ref: 'P05', quantite: 1 }],
        total_fcfa: 24000,
        turnId: 1,
      },
    };

    const result = await runAgent({
      llm,
      tools,
      instructions: SYSTEM_INSTRUCTIONS,
      userMessage: 'oui je confirme',
      orderStrategy: 'async',
      conversation,
      shop,
    });

    expect(result.submittedOrders).toEqual([]);
    const toolMsg = result.messages.find((m) => m.role === 'tool');
    const toolContent = JSON.parse(toolMsg!.content!);
    expect(toolContent.erreur).toBe('confirmation requise');
    expect(toolContent.detail).toContain('zone de livraison');
  });

  it('chemin complet sur deux tours scriptés (devis puis oui je confirme)', async () => {
    const shop = new Shop();
    const tools = createDefaultRegistry(shop);

    // ==========================================
    // TOUR 1 : Demande de devis
    // ==========================================
    const responsesTour1: ChatResponse[] = [
      {
        message: {
          role: 'assistant',
          content: null,
          tool_calls: [
            {
              id: 'call-calc',
              type: 'function',
              function: {
                name: 'calculer_total',
                arguments: JSON.stringify({
                  zone: 'Calavi',
                  articles: [{ ref: 'P05', quantite: 2 }],
                }),
              },
            },
          ],
        },
        usage: createDummyUsage(),
        model: 'fake-model',
      },
      {
        message: {
          role: 'assistant',
          content:
            'Pour 2 robes en wax à Calavi, le total est de 46 000 FCFA livraison comprise. Confirmez-vous la commande ?',
        },
        usage: createDummyUsage(),
        model: 'fake-model',
      },
    ];

    const llmTour1 = new FakeLlm(responsesTour1);
    const convTour1: ConversationContext = {
      chatId: 'client-whatsapp-123',
      turnId: 1,
    };

    const resultTour1 = await runAgent({
      llm: llmTour1,
      tools,
      instructions: SYSTEM_INSTRUCTIONS,
      userMessage: 'Combien pour 2 robes en wax avec livraison à Calavi ?',
      orderStrategy: 'async',
      conversation: convTour1,
      shop,
    });

    expect(resultTour1.submittedOrders).toEqual([]);
    expect(convTour1.lastQuote).toBeDefined();
    expect(convTour1.lastQuote?.zone).toBe('Calavi');
    expect(convTour1.lastQuote?.total_fcfa).toBe(46000);
    expect(convTour1.lastQuote?.turnId).toBe(1);

    // ==========================================
    // TOUR 2 : Accord explicite du client
    // ==========================================
    const responsesTour2: ChatResponse[] = [
      {
        message: {
          role: 'assistant',
          content: null,
          tool_calls: [
            {
              id: 'call-create',
              type: 'function',
              function: {
                name: 'creer_commande',
                arguments: JSON.stringify({
                  client_nom: 'Koffi Mensah',
                  zone: 'Calavi',
                  articles: [{ ref: 'P05', quantite: 2 }],
                }),
              },
            },
          ],
        },
        usage: createDummyUsage(),
        model: 'fake-model',
      },
      {
        message: {
          role: 'assistant',
          content:
            'Votre commande est en attente de validation par la boutique. Vous serez prévenu par message.',
        },
        usage: createDummyUsage(),
        model: 'fake-model',
      },
    ];

    const llmTour2 = new FakeLlm(responsesTour2);
    // Incrémente turnId à 2
    const convTour2: ConversationContext = {
      ...convTour1,
      turnId: 2,
      lastClientMessage: 'oui je confirme',
    };

    const resultTour2 = await runAgent({
      llm: llmTour2,
      tools,
      instructions: SYSTEM_INSTRUCTIONS,
      userMessage: 'oui je confirme',
      orderStrategy: 'async',
      conversation: convTour2,
      shop,
    });

    expect(resultTour2.submittedOrders).toHaveLength(1);
    expect(resultTour2.submittedOrders![0]?.numero).toBe(1);
    expect(resultTour2.submittedOrders![0]?.cancelledNumbers).toEqual([]);

    // Trace contient l événement order_submitted
    const orderSubmittedEvent = resultTour2.trace.find(
      (e) => e.type === 'order_submitted',
    );
    expect(orderSubmittedEvent).toBeDefined();

    // Vérifie dans Shop : statut en_attente_afi, stock intact
    const allOrders = await shop.getOrders();
    expect(allOrders).toHaveLength(1);
    expect(allOrders[0]?.statut).toBe('en_attente_afi');
    expect(allOrders[0]?.chatId).toBe('client-whatsapp-123');

    const stock = await shop.checkStock('P05');
    expect(stock?.stock).toBe(5); // Non décrémenté
  });

  it('mode console reste inchangé et fonctionne avec ApprovalPort', async () => {
    const shop = new Shop();
    const tools = createDefaultRegistry(shop);
    const approval = new FakeApproval([{ approved: true }]);

    const responses: ChatResponse[] = [
      {
        message: {
          role: 'assistant',
          content: null,
          tool_calls: [
            {
              id: 'call-1',
              type: 'function',
              function: {
                name: 'creer_commande',
                arguments: JSON.stringify({
                  client_nom: 'Client Console',
                  zone: 'Cotonou',
                  articles: [{ ref: 'P01', quantite: 1 }],
                }),
              },
            },
          ],
        },
        usage: createDummyUsage(),
        model: 'fake-model',
      },
      {
        message: {
          role: 'assistant',
          content: 'Commande enregistrée.',
        },
        usage: createDummyUsage(),
        model: 'fake-model',
      },
    ];

    const llm = new FakeLlm(responses);

    const result = await runAgent({
      llm,
      tools,
      instructions: SYSTEM_INSTRUCTIONS,
      userMessage: 'Crée la commande',
      orderStrategy: 'console',
      approval,
      shop,
    });

    expect(approval.requests).toHaveLength(1);
    const allOrders = await shop.getOrders();
    expect(allOrders).toHaveLength(1);
    expect(allOrders[0]?.statut).toBe('confirmee');

    // Le stock est décrémenté immédiatement en mode console
    const stock = await shop.checkStock('P01');
    expect(stock?.stock).toBe(13);
  });
});
