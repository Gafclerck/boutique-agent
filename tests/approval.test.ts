import { describe, expect, it } from 'vitest';
import { FakeApproval } from '../src/adapters/approval/fake-approval.js';
import { FakeLlm } from '../src/adapters/llm/fake-llm.js';
import { SYSTEM_INSTRUCTIONS } from '../src/agent/instructions.js';
import { runAgent } from '../src/agent/loop.js';
import { Shop } from '../src/domain/shop.js';
import type { ChatResponse } from '../src/ports/llm-client.js';
import { createDefaultRegistry } from '../src/tools/registry.js';

describe('Human Approval Guard in Loop', () => {
  it('refus : outil non exécuté, observation renvoyée au LLM, stock inchangé et aucune commande créée', async () => {
    const shop = new Shop();
    const tools = createDefaultRegistry(shop);
    const approval = new FakeApproval([
      { approved: false, reason: 'refusé par le superviseur' },
    ]);

    const step1Response: ChatResponse = {
      message: {
        role: 'assistant',
        content: null,
        tool_calls: [
          {
            id: 'call_cmd',
            type: 'function',
            function: {
              name: 'creer_commande',
              arguments: JSON.stringify({
                client_nom: 'Koffi Mensah',
                zone: 'Cotonou',
                articles: [{ ref: 'P01', quantite: 2 }],
              }),
            },
          },
        ],
      },
      usage: { promptTokens: 100, completionTokens: 20 },
      model: 'fake-model',
    };

    const step2Response: ChatResponse = {
      message: {
        role: 'assistant',
        content:
          'La boutique n’a malheureusement pas validé votre commande.',
        tool_calls: undefined,
      },
      usage: { promptTokens: 120, completionTokens: 15 },
      model: 'fake-model',
    };

    const fakeLlm = new FakeLlm([step1Response, step2Response]);

    const result = await runAgent({
      llm: fakeLlm,
      tools,
      instructions: SYSTEM_INSTRUCTIONS,
      userMessage: 'Je confirme la commande.',
      approval,
    });

    // 1. Check approval port was interrogated
    expect(approval.requests).toHaveLength(1);
    expect(approval.requests[0]?.toolName).toBe('creer_commande');
    expect(approval.requests[0]?.recapitulatif).toContain('Koffi Mensah');
    expect(approval.requests[0]?.recapitulatif).toContain('25 000 FCFA');

    // 2. Check observation received by the LLM
    const toolMsg = result.messages.find((m) => m.role === 'tool');
    expect(toolMsg).toBeDefined();
    const parsedObservation = JSON.parse(toolMsg!.content!);
    expect(parsedObservation).toEqual({
      erreur: 'commande refusée par la boutique',
      conseil:
        "informer le client poliment que la commande n'a pas été validée ; ne pas la recréer sans nouvelle demande du client",
    });

    // 3. Check stock is untouched (14) and no orders
    const stockP01 = (await shop.checkStock('P01'))?.stock;
    expect(stockP01).toBe(14);
    const orders = await shop.getOrders();
    expect(orders).toHaveLength(0);

    // 4. Trace has approval event
    const approvalEvent = result.trace.find((e) => e.type === 'approval');
    expect(approvalEvent).toMatchObject({
      type: 'approval',
      tool: 'creer_commande',
      decision: false,
      reason: 'refusé par le superviseur',
    });
  });

  it('approbation : outil exécuté, commande enregistrée et stock décrémenté', async () => {
    const shop = new Shop();
    const tools = createDefaultRegistry(shop);
    const approval = new FakeApproval([
      { approved: true, reason: 'validé par la boutique' },
    ]);

    const step1Response: ChatResponse = {
      message: {
        role: 'assistant',
        content: null,
        tool_calls: [
          {
            id: 'call_cmd_ok',
            type: 'function',
            function: {
              name: 'creer_commande',
              arguments: JSON.stringify({
                client_nom: 'Amina',
                zone: 'Fidjrossè',
                articles: [{ ref: 'P01', quantite: 1 }],
              }),
            },
          },
        ],
      },
      usage: { promptTokens: 100, completionTokens: 20 },
      model: 'fake-model',
    };

    const step2Response: ChatResponse = {
      message: {
        role: 'assistant',
        content: 'Votre commande a été confirmée !',
        tool_calls: undefined,
      },
      usage: { promptTokens: 140, completionTokens: 15 },
      model: 'fake-model',
    };

    const fakeLlm = new FakeLlm([step1Response, step2Response]);

    const result = await runAgent({
      llm: fakeLlm,
      tools,
      instructions: SYSTEM_INSTRUCTIONS,
      userMessage: 'Je confirme la commande.',
      approval,
    });

    // 1. Observation has order details
    const toolMsg = result.messages.find((m) => m.role === 'tool');
    const parsedObservation = JSON.parse(toolMsg!.content!);
    expect(parsedObservation.numero_commande).toBe('CMD-1');
    expect(parsedObservation.client_nom).toBe('Amina');

    // 2. Stock decremented (14 -> 13)
    const stockP01 = (await shop.checkStock('P01'))?.stock;
    expect(stockP01).toBe(13);

    // 3. Order is registered in shop
    const orders = await shop.getOrders();
    expect(orders).toHaveLength(1);
    expect(orders[0]?.numero_commande).toBe('CMD-1');

    // 4. Trace has approval event
    const approvalEvent = result.trace.find((e) => e.type === 'approval');
    expect(approvalEvent).toMatchObject({
      type: 'approval',
      tool: 'creer_commande',
      decision: true,
    });
  });

  it('sans port d’approbation : refus systématique avec "validation indisponible" (fail closed)', async () => {
    const shop = new Shop();
    const tools = createDefaultRegistry(shop);

    const step1Response: ChatResponse = {
      message: {
        role: 'assistant',
        content: null,
        tool_calls: [
          {
            id: 'call_no_port',
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
      usage: { promptTokens: 100, completionTokens: 20 },
      model: 'fake-model',
    };

    const step2Response: ChatResponse = {
      message: {
        role: 'assistant',
        content: 'Service indisponible.',
        tool_calls: undefined,
      },
      usage: { promptTokens: 120, completionTokens: 10 },
      model: 'fake-model',
    };

    const fakeLlm = new FakeLlm([step1Response, step2Response]);

    // No approval port provided!
    const result = await runAgent({
      llm: fakeLlm,
      tools,
      instructions: SYSTEM_INSTRUCTIONS,
      userMessage: 'Valider',
    });

    const toolMsg = result.messages.find((m) => m.role === 'tool');
    const parsedObservation = JSON.parse(toolMsg!.content!);
    expect(parsedObservation.erreur).toBe('validation indisponible');

    expect((await shop.checkStock('P01'))?.stock).toBe(14);
    expect(await shop.getOrders()).toHaveLength(0);
  });

  it('erreur de prévisualisation : renvoie l’erreur métier habituelle SANS solliciter l’approbation', async () => {
    const shop = new Shop();
    const tools = createDefaultRegistry(shop);
    const approval = new FakeApproval();

    const step1Response: ChatResponse = {
      message: {
        role: 'assistant',
        content: null,
        tool_calls: [
          {
            id: 'call_preview_fail',
            type: 'function',
            function: {
              name: 'creer_commande',
              arguments: JSON.stringify({
                client_nom: 'Koffi',
                zone: 'Cotonou',
                articles: [{ ref: 'P03', quantite: 1 }], // P03 is out of stock (stock 0)
              }),
            },
          },
        ],
      },
      usage: { promptTokens: 100, completionTokens: 20 },
      model: 'fake-model',
    };

    const step2Response: ChatResponse = {
      message: {
        role: 'assistant',
        content: 'Le produit est en rupture de stock.',
        tool_calls: undefined,
      },
      usage: { promptTokens: 120, completionTokens: 10 },
      model: 'fake-model',
    };

    const fakeLlm = new FakeLlm([step1Response, step2Response]);

    const result = await runAgent({
      llm: fakeLlm,
      tools,
      instructions: SYSTEM_INSTRUCTIONS,
      userMessage: 'Je commande le sac.',
      approval,
    });

    // Approval port was NEVER called because preview failed!
    expect(approval.requests).toHaveLength(0);

    // Business error is returned directly
    const toolMsg = result.messages.find((m) => m.role === 'tool');
    const parsed = JSON.parse(toolMsg!.content!);
    expect(parsed.erreur).toBe('stock insuffisant pour Sac en raphia');
    expect(parsed.stock_disponible).toBe(0);

    // No approval event in trace
    const approvalEvent = result.trace.find((e) => e.type === 'approval');
    expect(approvalEvent).toBeUndefined();
  });
});
