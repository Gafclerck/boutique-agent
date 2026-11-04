import { describe, expect, it } from 'vitest';
import { FakeLlm } from '../src/adapters/llm/fake-llm.js';
import {
  BudgetExceededError,
  createCallBudget,
  withCallBudget,
} from '../src/agent/budget.js';
import { SYSTEM_INSTRUCTIONS } from '../src/agent/instructions.js';
import {
  EVALUATION_FALLBACK_MESSAGE,
  runAgent,
} from '../src/agent/loop.js';
import { LlmError, type ChatResponse } from '../src/ports/llm-client.js';
import { ToolRegistry } from '../src/tools/registry.js';
import type { Tool } from '../src/tools/types.js';

describe('TACHE D : Budget d\'appels par tour', () => {
  it('dépassement : runAgent capture BudgetExceededError et renvoie fallback sans nombre', async () => {
    const dummyTool: Tool = {
      name: 'dummy_tool',
      description: 'Outil test',
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
    const tools = new ToolRegistry();
    tools.register(dummyTool);

    // FakeLlm with 2 responses: step 1 calls dummy_tool, step 2 would answer
    const fakeLlm = new FakeLlm([
      {
        message: {
          role: 'assistant',
          content: null,
          tool_calls: [{ id: 'c1', type: 'function', function: { name: 'dummy_tool', arguments: '{}' } }],
        },
        usage: { promptTokens: 20, completionTokens: 10 },
        model: 'test-model',
      },
      {
        message: { role: 'assistant', content: 'Réponse finale' },
        usage: { promptTokens: 30, completionTokens: 10 },
        model: 'test-model',
      },
    ]);

    // Budget allowed: only 1 call
    const budget = createCallBudget(1);
    const cappedLlm = withCallBudget(fakeLlm, budget);

    const result = await runAgent({
      llm: cappedLlm,
      tools,
      instructions: SYSTEM_INSTRUCTIONS,
      userMessage: 'Bonjour',
    });

    expect(result.stopReason).toBe('budget_exceeded');
    expect(result.reply).toBe(EVALUATION_FALLBACK_MESSAGE);

    // Stop trace event contains budget_exceeded
    const stopEvent = result.trace.find((e) => e.type === 'stop');
    expect(stopEvent).toBeDefined();
    expect(stopEvent?.reason).toBe('budget_exceeded');
  });

  it('compteur partagé entre deux clients : agent et juge', async () => {
    const budget = createCallBudget(2);

    const fakeLlm1 = new FakeLlm([
      { message: { role: 'assistant', content: 'Agent response' }, usage: { promptTokens: 10, completionTokens: 5 }, model: 'm1' },
      { message: { role: 'assistant', content: 'Agent response 2' }, usage: { promptTokens: 10, completionTokens: 5 }, model: 'm1' },
    ]);
    const fakeLlm2 = new FakeLlm([
      { message: { role: 'assistant', content: 'Judge response' }, usage: { promptTokens: 10, completionTokens: 5 }, model: 'm2' },
    ]);

    const client1 = withCallBudget(fakeLlm1, budget);
    const client2 = withCallBudget(fakeLlm2, budget);

    // Call 1 on client1 (count = 1 <= 2)
    const r1 = await client1.chat({ messages: [{ role: 'user', content: 'hello' }] });
    expect(r1.message.content).toBe('Agent response');
    expect(budget.count).toBe(1);

    // Call 2 on client2 (count = 2 <= 2)
    const r2 = await client2.chat({ messages: [{ role: 'user', content: 'judge' }] });
    expect(r2.message.content).toBe('Judge response');
    expect(budget.count).toBe(2);

    // Call 3 on client1 (count = 3 > 2 -> throws BudgetExceededError)
    await expect(
      client1.chat({ messages: [{ role: 'user', content: 'hello again' }] }),
    ).rejects.toThrow(BudgetExceededError);
    expect(budget.count).toBe(3);
  });

  it('erreurs autres que BudgetExceededError non masquées', async () => {
    const failingLlm = {
      async chat() {
        throw new LlmError(500, 'Service Unavailable');
      },
    };

    const budget = createCallBudget(10);
    const cappedLlm = withCallBudget(failingLlm, budget);

    const tools = new ToolRegistry();

    await expect(
      runAgent({
        llm: cappedLlm,
        tools,
        instructions: SYSTEM_INSTRUCTIONS,
        userMessage: 'Test',
      }),
    ).rejects.toThrow(LlmError);
  });

  it('tour sans dépassement inchangé', async () => {
    const fakeLlm = new FakeLlm([
      {
        message: { role: 'assistant', content: 'Bonjour ! Comment puis-je vous aider ?' },
        usage: { promptTokens: 50, completionTokens: 15 },
        model: 'test-model',
      },
    ]);

    const budget = createCallBudget(5);
    const cappedLlm = withCallBudget(fakeLlm, budget);
    const tools = new ToolRegistry();

    const result = await runAgent({
      llm: cappedLlm,
      tools,
      instructions: SYSTEM_INSTRUCTIONS,
      userMessage: 'Bonjour',
    });

    expect(result.stopReason).toBe('answered');
    expect(result.reply).toBe('Bonjour ! Comment puis-je vous aider ?');
    expect(result.llmCalls).toBe(1);
    expect(budget.count).toBe(1);
  });
});
