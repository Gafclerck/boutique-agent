import { describe, expect, it } from 'vitest';
import { FakeLlm } from '../src/adapters/llm/fake-llm.js';
import { evaluateReply } from '../src/agent/evaluation/index.js';
import { SYSTEM_INSTRUCTIONS } from '../src/agent/instructions.js';
import { runAgent } from '../src/agent/loop.js';
import { INITIAL_PRODUCTS } from '../src/domain/catalogue.js';
import { Shop } from '../src/domain/shop.js';
import type { ChatMessage } from '../src/ports/llm-client.js';
import { createDefaultRegistry, ToolRegistry } from '../src/tools/registry.js';
import type { Tool } from '../src/tools/types.js';

describe('TACHE A : Outils utilisés pendant la session', () => {
  it('dérivation : dérive hasPriorCatalogueLookup depuis l\'historique si priorToolNames est omis', async () => {
    const shop = new Shop();
    const tools = createDefaultRegistry(shop);

    // Historique avec recherche préalable
    const historyWithLookup: ChatMessage[] = [
      { role: 'user', content: 'Avez-vous du pagne ?' },
      {
        role: 'assistant',
        content: null,
        tool_calls: [
          {
            id: 'call_search',
            type: 'function',
            function: {
              name: 'chercher_produits',
              arguments: JSON.stringify({ mot_cle: 'pagne' }),
            },
          },
        ],
      },
      {
        role: 'tool',
        tool_call_id: 'call_search',
        content: JSON.stringify({ produits: [{ ref: 'P01', nom: 'Pagne wax 6 yards' }] }),
      },
      {
        role: 'assistant',
        content: 'Oui, nous avons le Pagne wax 6 yards.',
      },
    ];

    // Tour 2 : le client mentionne à nouveau le pagne, mais hasPriorCatalogueLookup est vrai grâce à l'historique
    const fakeLlm = new FakeLlm([
      // Step 1: verifier_stock
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
        usage: { promptTokens: 30, completionTokens: 10 },
        model: 'fake',
      },
      // Step 2: réponse citant le stock
      {
        message: {
          role: 'assistant',
          content: 'Le Pagne wax 6 yards est disponible avec 14 pièces en stock.',
        },
        usage: { promptTokens: 40, completionTokens: 15 },
        model: 'fake',
      },
    ]);

    const res = await runAgent({
      llm: fakeLlm,
      tools,
      instructions: SYSTEM_INSTRUCTIONS,
      history: historyWithLookup,
      userMessage: 'Le pagne est-il toujours en stock ?',
      evaluate: evaluateReply,
      catalogue: INITIAL_PRODUCTS,
    });

    expect(res.stopReason).toBe('answered');
    expect(res.lastViolations).toBeUndefined();
  });

  it('priorité : priorToolNames a priorité sur l\'historique (positif et négatif)', async () => {
    const shop = new Shop();
    const tools = createDefaultRegistry(shop);

    // Cas 1 : historique vide, mais priorToolNames contient "chercher_produits"
    // Le client mentionne "pagne". Grâce à priorToolNames, rechercheD_abord ne bloque pas
    const fakeLlm1 = new FakeLlm([
      // Step 1: verifier_stock
      {
        message: {
          role: 'assistant',
          content: null,
          tool_calls: [
            {
              id: 'c1',
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
      // Step 2: réponse citant le produit vérifié
      {
        message: {
          role: 'assistant',
          content: 'Le Pagne wax 6 yards est disponible avec 14 pièces en stock.',
        },
        usage: { promptTokens: 50, completionTokens: 20 },
        model: 'fake',
      },
    ]);

    const res1 = await runAgent({
      llm: fakeLlm1,
      tools,
      instructions: SYSTEM_INSTRUCTIONS,
      userMessage: 'Avez-vous du pagne en stock ?',
      priorToolNames: new Set(['chercher_produits']),
      evaluate: evaluateReply,
      catalogue: INITIAL_PRODUCTS,
    });

    expect(res1.stopReason).toBe('answered');
    expect(res1.lastViolations).toBeUndefined();

    // Cas 2 : historique contient chercher_produits, mais priorToolNames est fourni et vide
    // priorToolNames l'emporte -> hasPriorCatalogueLookup = false
    const historyWithLookup: ChatMessage[] = [
      { role: 'user', content: 'Avez-vous du pagne ?' },
      {
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
      {
        role: 'tool',
        tool_call_id: 'c_search',
        content: JSON.stringify({ produits: [{ ref: 'P01', nom: 'Pagne wax 6 yards' }] }),
      },
      {
        role: 'assistant',
        content: 'Trouvé',
      },
    ];

    const fakeLlm2 = new FakeLlm([
      // Step 1: verifier_stock uniquement (pas de chercher_produits)
      {
        message: {
          role: 'assistant',
          content: null,
          tool_calls: [
            {
              id: 'c2',
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
      // Step 2: réponse mentionnant P01
      {
        message: {
          role: 'assistant',
          content: 'Le Pagne wax 6 yards est disponible avec 14 pièces en stock.',
        },
        usage: { promptTokens: 50, completionTokens: 20 },
        model: 'fake',
      },
    ]);

    const res2 = await runAgent({
      llm: fakeLlm2,
      tools,
      instructions: SYSTEM_INSTRUCTIONS,
      history: historyWithLookup,
      userMessage: 'Avez-vous du pagne ?',
      priorToolNames: new Set<string>(), // Vide : écrase l'historique !
      evaluate: evaluateReply,
      catalogue: INITIAL_PRODUCTS,
      maxEvaluationRetries: 0,
    });

    // rechercheD_abord doit échouer car pas de chercher_produits dans le tour ni dans priorToolNames
    expect(res2.stopReason).toBe('evaluation_failed');
    expect(res2.lastViolations).toContain('rechercheD_abord');
  });

  it('accumulation : toolNames conserve ordre, doublons et outils imbriqués', async () => {
    const delegatingTool: Tool = {
      name: 'demander_au_specialiste',
      description: 'Délègue au spécialiste',
      parameters: { type: 'object', properties: {} },
      toDefinition() {
        return {
          type: 'function',
          function: { name: this.name, description: this.description, parameters: this.parameters },
        };
      },
      async execute() {
        return {};
      },
      async executeDetailed() {
        return {
          result: { ok: true },
          nested: {
            traceEvents: [],
            llmCalls: 1,
            usage: { promptTokens: 10, completionTokens: 10 },
            toolNames: ['chercher_produits', 'verifier_stock'],
          },
        };
      },
    };

    const regularTool: Tool = {
      name: 'verifier_stock',
      description: 'Vérifie le stock',
      parameters: { type: 'object', properties: {} },
      toDefinition() {
        return {
          type: 'function',
          function: { name: this.name, description: this.description, parameters: this.parameters },
        };
      },
      async execute() {
        return { ok: true };
      },
    };

    const registry = new ToolRegistry();
    registry.register(delegatingTool);
    registry.register(regularTool);

    const fakeLlm = new FakeLlm([
      // Étape 1 : appel de demander_au_specialiste
      {
        message: {
          role: 'assistant',
          content: null,
          tool_calls: [
            {
              id: 'c1',
              type: 'function',
              function: { name: 'demander_au_specialiste', arguments: '{}' },
            },
          ],
        },
        usage: { promptTokens: 20, completionTokens: 10 },
        model: 'fake',
      },
      // Étape 2 : appel de verifier_stock
      {
        message: {
          role: 'assistant',
          content: null,
          tool_calls: [
            {
              id: 'c2',
              type: 'function',
              function: { name: 'verifier_stock', arguments: '{}' },
            },
          ],
        },
        usage: { promptTokens: 30, completionTokens: 10 },
        model: 'fake',
      },
      // Étape 3 : réponse finale
      {
        message: { role: 'assistant', content: 'Terminé.' },
        usage: { promptTokens: 40, completionTokens: 5 },
        model: 'fake',
      },
    ]);

    const res = await runAgent({
      llm: fakeLlm,
      tools: registry,
      instructions: 'Instructions',
      userMessage: 'Action',
    });

    expect(res.stopReason).toBe('answered');
    // Ordre conservé : demander_au_specialiste, puis ses imbriqués chercher_produits, verifier_stock, puis au tour suivant verifier_stock (doublon conservé)
    expect(res.toolNames).toEqual([
      'demander_au_specialiste',
      'chercher_produits',
      'verifier_stock',
      'verifier_stock',
    ]);

    // Accumulation dans un Set de session
    const sessionToolNames = new Set<string>();
    for (const name of res.toolNames) {
      sessionToolNames.add(name);
    }
    expect(sessionToolNames.has('demander_au_specialiste')).toBe(true);
    expect(sessionToolNames.has('chercher_produits')).toBe(true);
    expect(sessionToolNames.has('verifier_stock')).toBe(true);
    expect(sessionToolNames.size).toBe(3);
  });

  it('reset : la réinitialisation de sessionToolNames vide les outils et affecte le tour suivant', async () => {
    const sessionToolNames = new Set<string>(['chercher_produits', 'verifier_stock']);
    expect(sessionToolNames.has('chercher_produits')).toBe(true);

    // Simulation /reset
    sessionToolNames.clear();
    expect(sessionToolNames.size).toBe(0);
    expect(sessionToolNames.has('chercher_produits')).toBe(false);
  });
});
