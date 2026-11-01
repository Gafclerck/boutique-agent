import { describe, expect, it } from 'vitest';
import { FakeLlm } from '../src/adapters/llm/fake-llm.js';
import { SYSTEM_INSTRUCTIONS } from '../src/agent/instructions.js';
import {
  FALLBACK_EMPTY_REPLY_MESSAGE,
  FALLBACK_MAX_STEPS_MESSAGE,
  runAgent,
} from '../src/agent/loop.js';
import { Shop } from '../src/domain/shop.js';
import type { ChatResponse } from '../src/ports/llm-client.js';
import { createDefaultRegistry } from '../src/tools/registry.js';

describe('Agent Loop with FakeLlm', () => {
  it('chains 2 tools, appends final assistant reply to messages, and returns complete conversation', async () => {
    const shop = new Shop();
    const tools = createDefaultRegistry(shop);

    const step1Response: ChatResponse = {
      message: {
        role: 'assistant',
        content: null,
        tool_calls: [
          {
            id: 'call_1',
            type: 'function',
            function: {
              name: 'chercher_produits',
              arguments: JSON.stringify({ mot_cle: 'pagne' }),
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
        content: null,
        tool_calls: [
          {
            id: 'call_2',
            type: 'function',
            function: {
              name: 'verifier_stock',
              arguments: JSON.stringify({ ref: 'P01' }),
            },
          },
        ],
      },
      usage: { promptTokens: 150, completionTokens: 25 },
      model: 'fake-model',
    };

    const step3Response: ChatResponse = {
      message: {
        role: 'assistant',
        content:
          'Bonjour ! Le Pagne wax 6 yards est disponible à 12 000 FCFA (14 articles en stock). Souhaitez-vous une livraison ?',
        tool_calls: undefined,
      },
      usage: { promptTokens: 200, completionTokens: 35 },
      model: 'fake-model',
    };

    const fakeLlm = new FakeLlm([step1Response, step2Response, step3Response]);

    const result = await runAgent({
      llm: fakeLlm,
      tools,
      instructions: SYSTEM_INSTRUCTIONS,
      userMessage: 'Avez-vous des pagnes en stock ?',
    });

    expect(result.stopReason).toBe('answered');
    expect(result.steps).toBe(3);
    expect(result.llmCalls).toBe(3);
    expect(result.reply).toBe(
      'Bonjour ! Le Pagne wax 6 yards est disponible à 12 000 FCFA (14 articles en stock). Souhaitez-vous une livraison ?',
    );

    // Verify result.messages is the complete conversation including the final assistant reply
    // Messages: system (0), user (1), assistant call 1 (2), tool 1 (3), assistant call 2 (4), tool 2 (5), assistant final (6)
    expect(result.messages.length).toBe(7);
    expect(result.messages[0]).toEqual({
      role: 'system',
      content: SYSTEM_INSTRUCTIONS,
    });
    expect(result.messages[1]).toEqual({
      role: 'user',
      content: 'Avez-vous des pagnes en stock ?',
    });
    expect(result.messages[2]?.role).toBe('assistant');
    expect(result.messages[3]?.role).toBe('tool');
    expect(result.messages[4]?.role).toBe('assistant');
    expect(result.messages[5]?.role).toBe('tool');
    const lastMsg = result.messages[result.messages.length - 1];
    expect(lastMsg).toEqual({
      role: 'assistant',
      content:
        'Bonjour ! Le Pagne wax 6 yards est disponible à 12 000 FCFA (14 articles en stock). Souhaitez-vous une livraison ?',
    });

    // Verify cumulative token counters
    expect(result.usage.promptTokens).toBe(450);
    expect(result.usage.completionTokens).toBe(80);
    expect(result.usage.totalTokens).toBe(530);

    // Verify requests sent to LLM
    expect(fakeLlm.requests).toHaveLength(3);

    // Step 2 request should have tool result for call_1
    const secondReqMessages = fakeLlm.requests[1]?.messages ?? [];
    const toolMsg1 = secondReqMessages.find(
      (m) => m.role === 'tool' && m.tool_call_id === 'call_1',
    );
    expect(toolMsg1).toBeDefined();
    expect(toolMsg1?.content).toContain('Pagne wax 6 yards');

    // Step 3 request should have tool result for call_2
    const thirdReqMessages = fakeLlm.requests[2]?.messages ?? [];
    const toolMsg2 = thirdReqMessages.find(
      (m) => m.role === 'tool' && m.tool_call_id === 'call_2',
    );
    expect(toolMsg2).toBeDefined();
    expect(toolMsg2?.content).toContain('"disponible":true');
  });

  it('handles empty or whitespace-only reply by returning polite fallback and empty_reply stopReason', async () => {
    const shop = new Shop();
    const tools = createDefaultRegistry(shop);

    const emptyReplyResponse: ChatResponse = {
      message: {
        role: 'assistant',
        content: '   ',
      },
      usage: { promptTokens: 60, completionTokens: 5 },
      model: 'fake-model',
    };

    const fakeLlm = new FakeLlm([emptyReplyResponse]);

    const result = await runAgent({
      llm: fakeLlm,
      tools,
      instructions: SYSTEM_INSTRUCTIONS,
      userMessage: 'Test empty reply',
    });

    expect(result.stopReason).toBe('empty_reply');
    expect(result.reply).toBe(FALLBACK_EMPTY_REPLY_MESSAGE);

    // Final assistant message in result.messages should be the polite fallback
    const lastMsg = result.messages[result.messages.length - 1];
    expect(lastMsg).toEqual({
      role: 'assistant',
      content: FALLBACK_EMPTY_REPLY_MESSAGE,
    });

    // Trace should contain stop event with reason empty_reply
    const stopEvent = result.trace.find((e) => e.type === 'stop');
    expect(stopEvent).toBeDefined();
    expect((stopEvent as { reason: string }).reason).toBe('empty_reply');
  });

  it('handles invalid JSON in tool arguments gracefully and reports observation error', async () => {
    const shop = new Shop();
    const tools = createDefaultRegistry(shop);

    const step1InvalidArgs: ChatResponse = {
      message: {
        role: 'assistant',
        content: null,
        tool_calls: [
          {
            id: 'call_broken',
            type: 'function',
            function: {
              name: 'chercher_produits',
              arguments: 'NOT_VALID_JSON{',
            },
          },
        ],
      },
      usage: { promptTokens: 50, completionTokens: 10 },
      model: 'fake-model',
    };

    const step2Reply: ChatResponse = {
      message: {
        role: 'assistant',
        content: 'Désolé pour le souci technique, quel produit cherchez-vous ?',
      },
      usage: { promptTokens: 70, completionTokens: 15 },
      model: 'fake-model',
    };

    const fakeLlm = new FakeLlm([step1InvalidArgs, step2Reply]);

    const result = await runAgent({
      llm: fakeLlm,
      tools,
      instructions: SYSTEM_INSTRUCTIONS,
      userMessage: 'Test invalid JSON',
    });

    expect(result.stopReason).toBe('answered');
    expect(result.steps).toBe(2);
    expect(result.reply).toBe(
      'Désolé pour le souci technique, quel produit cherchez-vous ?',
    );

    const secondReqMessages = fakeLlm.requests[1]?.messages ?? [];
    const toolMsg = secondReqMessages.find(
      (m) => m.role === 'tool' && m.tool_call_id === 'call_broken',
    );
    expect(toolMsg).toBeDefined();
    expect(toolMsg?.content).toContain('arguments JSON invalides');
  });

  it('handles unknown tool call by returning an observation error to the model', async () => {
    const shop = new Shop();
    const tools = createDefaultRegistry(shop);

    const step1UnknownTool: ChatResponse = {
      message: {
        role: 'assistant',
        content: null,
        tool_calls: [
          {
            id: 'call_unknown',
            type: 'function',
            function: {
              name: 'outil_fantome',
              arguments: '{}',
            },
          },
        ],
      },
      usage: { promptTokens: 40, completionTokens: 10 },
      model: 'fake-model',
    };

    const step2Reply: ChatResponse = {
      message: {
        role: 'assistant',
        content: 'Je peux vous aider à chercher nos articles du catalogue.',
      },
      usage: { promptTokens: 60, completionTokens: 15 },
      model: 'fake-model',
    };

    const fakeLlm = new FakeLlm([step1UnknownTool, step2Reply]);

    const result = await runAgent({
      llm: fakeLlm,
      tools,
      instructions: SYSTEM_INSTRUCTIONS,
      userMessage: 'Test unknown tool',
    });

    expect(result.stopReason).toBe('answered');
    const secondReqMessages = fakeLlm.requests[1]?.messages ?? [];
    const toolMsg = secondReqMessages.find(
      (m) => m.role === 'tool' && m.tool_call_id === 'call_unknown',
    );
    expect(toolMsg).toBeDefined();
    expect(toolMsg?.content).toContain('outil inconnu');
    expect(toolMsg?.content).toContain('outil_fantome');
  });

  it('stops when max_steps is reached and returns polite fallback message', async () => {
    const shop = new Shop();
    const tools = createDefaultRegistry(shop);

    // Create an endless loop of tool calls
    const infiniteToolResponse = (): ChatResponse => ({
      message: {
        role: 'assistant',
        content: null,
        tool_calls: [
          {
            id: 'call_loop',
            type: 'function',
            function: {
              name: 'chercher_produits',
              arguments: JSON.stringify({ mot_cle: 'pagne' }),
            },
          },
        ],
      },
      usage: { promptTokens: 50, completionTokens: 10 },
      model: 'fake-model',
    });

    const fakeLlm = new FakeLlm([
      infiniteToolResponse(),
      infiniteToolResponse(),
      infiniteToolResponse(),
    ]);

    const result = await runAgent({
      llm: fakeLlm,
      tools,
      instructions: SYSTEM_INSTRUCTIONS,
      userMessage: 'Boucle infinie',
      maxSteps: 3,
    });

    expect(result.stopReason).toBe('max_steps');
    expect(result.steps).toBe(3);
    expect(result.llmCalls).toBe(3);
    expect(result.reply).toBe(FALLBACK_MAX_STEPS_MESSAGE);
    expect(result.messages[result.messages.length - 1]).toEqual({
      role: 'assistant',
      content: FALLBACK_MAX_STEPS_MESSAGE,
    });
  });
});
