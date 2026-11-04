import { describe, expect, it } from 'vitest';
import { FakeLlm } from '../src/adapters/llm/fake-llm.js';
import { evaluateReply } from '../src/agent/evaluation/index.js';
import { SYSTEM_INSTRUCTIONS } from '../src/agent/instructions.js';
import { runAgent } from '../src/agent/loop.js';
import { formatTrace, type ToolCallTraceEvent } from '../src/agent/trace.js';
import { INITIAL_PRODUCTS } from '../src/domain/catalogue.js';
import type { ChatResponse } from '../src/ports/llm-client.js';
import { ToolRegistry } from '../src/tools/registry.js';
import type { Tool } from '../src/tools/types.js';

describe('TACHE B : Rôle, traces imbriquées, durée et FakeLlm par rôle', () => {
  it('ChatRequest gagne role et RunAgentParams transmet role (défaut "agent")', async () => {
    const fakeLlm = new FakeLlm([
      {
        message: { role: 'assistant', content: 'Bonjour !' },
        usage: { promptTokens: 50, completionTokens: 10 },
        model: 'fake',
      },
    ]);

    const tools = new ToolRegistry();

    // Default role: "agent"
    const resDefault = await runAgent({
      llm: fakeLlm,
      tools,
      instructions: SYSTEM_INSTRUCTIONS,
      userMessage: 'Salut',
    });

    expect(resDefault.stopReason).toBe('answered');
    expect(fakeLlm.requests[0]?.role).toBe('agent');
    expect(resDefault.trace[0]?.agent).toBe('agent');

    // Custom role: "gerant"
    const fakeLlm2 = new FakeLlm([
      {
        message: { role: 'assistant', content: 'Bienvenue chez Afi !' },
        usage: { promptTokens: 50, completionTokens: 10 },
        model: 'fake',
      },
    ]);

    const resCustom = await runAgent({
      llm: fakeLlm2,
      tools,
      instructions: SYSTEM_INSTRUCTIONS,
      userMessage: 'Salut',
      role: 'gerant',
    });

    expect(fakeLlm2.requests[0]?.role).toBe('gerant');
    expect(resCustom.trace[0]?.agent).toBe('gerant');
  });

  it('FakeLlm accepte des scripts par rôle { [role]: réponses[] } et lève une erreur explicite', async () => {
    const responseGerant: ChatResponse = {
      message: { role: 'assistant', content: 'Je suis le gérant.' },
      usage: { promptTokens: 40, completionTokens: 10 },
      model: 'fake',
    };
    const responseSpecialiste: ChatResponse = {
      message: { role: 'assistant', content: 'Je suis le spécialiste.' },
      usage: { promptTokens: 30, completionTokens: 10 },
      model: 'fake',
    };

    const fakeLlm = new FakeLlm({
      gerant: [responseGerant],
      specialiste_stock: [responseSpecialiste],
    });

    // 1. Call as gerant
    const resp1 = await fakeLlm.chat({
      messages: [{ role: 'user', content: 'test' }],
      role: 'gerant',
    });
    expect(resp1.message.content).toBe('Je suis le gérant.');

    // 2. Call as specialiste_stock
    const resp2 = await fakeLlm.chat({
      messages: [{ role: 'user', content: 'test' }],
      role: 'specialiste_stock',
    });
    expect(resp2.message.content).toBe('Je suis le spécialiste.');

    // 3. Gerant has no more responses -> explicit error
    await expect(
      fakeLlm.chat({
        messages: [{ role: 'user', content: 'test' }],
        role: 'gerant',
      }),
    ).rejects.toThrow('FakeLlm: No more scripted responses for role "gerant"');

    // 4. Role without script -> explicit error
    await expect(
      fakeLlm.chat({
        messages: [{ role: 'user', content: 'test' }],
        role: 'inconnu',
      }),
    ).rejects.toThrow('FakeLlm: No more scripted responses for role "inconnu"');
  });

  it('Tool avec executeDetailed imbrique des traces, compteurs, et seuls les résultats sont envoyés au LLM', async () => {
    const nestedStockEvent: ToolCallTraceEvent = {
      type: 'tool_call',
      step: 1,
      agent: 'specialiste_stock',
      name: 'verifier_stock',
      arguments: { ref: 'P01' },
      result: { ref: 'P01', nom: 'Pagne wax 6 yards', stock: 14, prix_fcfa: 12000 },
      durationMs: 7,
    };

    const delegatingTool: Tool = {
      name: 'demander_au_specialiste',
      description: 'Délègue au spécialiste',
      parameters: { type: 'object', properties: { question: { type: 'string' } } },
      toDefinition() {
        return {
          type: 'function',
          function: {
            name: this.name,
            description: this.description,
            parameters: this.parameters,
          },
        };
      },
      async execute() {
        return { fallback: true };
      },
      async executeDetailed(args) {
        return {
          result: { info: 'Pagne wax 6 yards disponible à 12 000 FCFA, 14 en stock' },
          nested: {
            traceEvents: [nestedStockEvent],
            llmCalls: 2,
            usage: { promptTokens: 60, completionTokens: 20, totalTokens: 80 },
          },
        };
      },
    };

    const tools = new ToolRegistry();
    tools.register(delegatingTool);

    const fakeLlm = new FakeLlm([
      // Step 1: agent calls delegatingTool
      {
        message: {
          role: 'assistant',
          content: null,
          tool_calls: [
            {
              id: 'call_nested',
              type: 'function',
              function: {
                name: 'demander_au_specialiste',
                arguments: JSON.stringify({ question: 'stock pagne' }),
              },
            },
          ],
        },
        usage: { promptTokens: 100, completionTokens: 20, totalTokens: 120 },
        model: 'main-agent',
      },
      // Step 2: agent gives final answer
      {
        message: {
          role: 'assistant',
          content: 'Le Pagne wax 6 yards est disponible à 12 000 FCFA (14 en stock).',
        },
        usage: { promptTokens: 150, completionTokens: 25, totalTokens: 175 },
        model: 'main-agent',
      },
    ]);

    const result = await runAgent({
      llm: fakeLlm,
      tools,
      instructions: SYSTEM_INSTRUCTIONS,
      userMessage: 'Est-il disponible ?',
      evaluate: evaluateReply,
      catalogue: INITIAL_PRODUCTS,
    });

    expect(result.stopReason).toBe('answered');

    // 1. LLM calls count: 2 (main agent) + 2 (nested) = 4
    expect(result.llmCalls).toBe(4);

    // 2. Token usage: 100+150+60 = 310 prompt, 20+25+20 = 65 completion, 120+175+80 = 375 total
    expect(result.usage.promptTokens).toBe(310);
    expect(result.usage.completionTokens).toBe(65);
    expect(result.usage.totalTokens).toBe(375);

    // 3. Duration is measured
    expect(typeof result.durationMs).toBe('number');
    expect(result.durationMs).toBeGreaterThanOrEqual(0);

    // 4. Trace events:
    // [0] llm_call (step 1, agent)
    // [1] tool_call (demander_au_specialiste, agent)
    // [2] tool_call (verifier_stock, specialiste_stock, nested: true)
    // [3] llm_call (step 2, agent)
    // [4] evaluation (step 2, agent, ok: true)
    // [5] stop (step 2, agent, answered)
    expect(result.trace[1]?.type).toBe('tool_call');
    expect(result.trace[1]?.agent).toBe('agent');
    expect((result.trace[1] as ToolCallTraceEvent).name).toBe('demander_au_specialiste');

    expect(result.trace[2]?.type).toBe('tool_call');
    expect(result.trace[2]?.agent).toBe('specialiste_stock');
    expect(result.trace[2]?.nested).toBe(true);
    expect((result.trace[2] as ToolCallTraceEvent).name).toBe('verifier_stock');

    // 5. SEUL result est renvoyé au LLM dans les messages
    const toolMessage = result.messages.find((m) => m.role === 'tool');
    expect(toolMessage).toBeDefined();
    expect(JSON.parse(toolMessage!.content!)).toEqual({
      info: 'Pagne wax 6 yards disponible à 12 000 FCFA, 14 en stock',
    });

    // 6. Les utilitaires d'évaluation (stockD_abord et ancrageDesNombres) voient l'événement imbriqué dans la trace aplatie !
    // Neither stockD_abord nor ancrageDesNombres failed, because P01 stock was verified and 12000 was in the nested event!
    expect(result.lastViolations).toBeUndefined();

    // 7. Rendu console: affiche le rôle et indente les événements imbriqués
    const rendered = formatTrace(result.trace);
    expect(rendered).toContain('[agent] [Étape 1] demander_au_specialiste');
    expect(rendered).toContain('  [specialiste_stock] [Étape 1] verifier_stock');
  });

  it('sans le tool_call imbriqué de verifier_stock, stockD_abord et ancrage lèvent des violations', () => {
    const traceWithoutNested = [
      {
        type: 'tool_call' as const,
        step: 1,
        agent: 'agent',
        name: 'demander_au_specialiste',
        arguments: {},
        result: { info: 'ok' },
        durationMs: 5,
      },
    ];

    const verdict = evaluateReply({
      userMessage: 'Est-il disponible ?',
      reply: 'Le Pagne wax 6 yards est disponible à 12 000 FCFA (14 en stock).',
      trace: traceWithoutNested,
      catalogue: INITIAL_PRODUCTS,
    });

    expect(verdict.ok).toBe(false);
    const rules = verdict.violations.map((v) => v.rule);
    expect(rules).toContain('stockD_abord');
    expect(rules).toContain('ancrageDesNombres');
  });
});
