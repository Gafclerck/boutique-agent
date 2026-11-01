import { describe, expect, it } from 'vitest';
import { RodiumClient } from '../src/adapters/llm/rodium-client.js';
import { LlmError } from '../src/ports/llm-client.js';

describe('RodiumClient - Configuration', () => {
  it('throws an immediate clear error if RODIUM_MODEL is missing', () => {
    // Ensure RODIUM_MODEL is not picked up from env during this test
    const originalModel = process.env.RODIUM_MODEL;
    const originalAiModel = process.env.RODIUMAI_MODEL;
    delete process.env.RODIUM_MODEL;
    delete process.env.RODIUMAI_MODEL;

    try {
      expect(() => {
        new RodiumClient({ apiKey: 'mock_key' });
      }).toThrow(/RODIUM_MODEL is required/);
    } finally {
      if (originalModel !== undefined) process.env.RODIUM_MODEL = originalModel;
      if (originalAiModel !== undefined) process.env.RODIUMAI_MODEL = originalAiModel;
    }
  });

  it('throws an immediate clear error if RODIUM_API_KEY is missing', () => {
    const originalKey = process.env.RODIUM_API_KEY;
    const originalAiKey = process.env.RODIUMAI_API_KEY;
    delete process.env.RODIUM_API_KEY;
    delete process.env.RODIUMAI_API_KEY;

    try {
      expect(() => {
        new RodiumClient({ model: 'anthropic/claude-haiku-4-5-20251001' });
      }).toThrow(/RODIUM_API_KEY is required/);
    } finally {
      if (originalKey !== undefined) process.env.RODIUM_API_KEY = originalKey;
      if (originalAiKey !== undefined) process.env.RODIUMAI_API_KEY = originalAiKey;
    }
  });
});

describe('RodiumClient - Retry Logic with Fake Fetch', () => {
  it('succès au 2e essai (après échec réseau temporaire)', async () => {
    let callCount = 0;
    const fakeFetch: typeof fetch = async () => {
      callCount++;
      if (callCount === 1) {
        throw new Error('Temporary network glitch');
      }
      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                role: 'assistant',
                content: 'Réponse après retry',
              },
            },
          ],
          usage: {
            prompt_tokens: 10,
            completion_tokens: 5,
            total_tokens: 15,
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    };

    const client = new RodiumClient({
      apiKey: 'test-key',
      model: 'anthropic/claude-haiku-4-5-20251001',
      fetchFn: fakeFetch,
      retryDelayMs: 1, // fast retry for tests
    });

    const response = await client.chat({
      messages: [{ role: 'user', content: 'Salut' }],
    });

    expect(callCount).toBe(2);
    expect(response.message.content).toBe('Réponse après retry');
  });

  it('succès au 2e essai (après HTTP 500)', async () => {
    let callCount = 0;
    const fakeFetch: typeof fetch = async () => {
      callCount++;
      if (callCount === 1) {
        return new Response('Server Error', { status: 500 });
      }
      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                role: 'assistant',
                content: 'Réponse après 500',
              },
            },
          ],
          usage: { prompt_tokens: 10, completion_tokens: 5 },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    };

    const client = new RodiumClient({
      apiKey: 'test-key',
      model: 'anthropic/claude-haiku-4-5-20251001',
      fetchFn: fakeFetch,
      retryDelayMs: 1,
    });

    const response = await client.chat({
      messages: [{ role: 'user', content: 'Salut' }],
    });

    expect(callCount).toBe(2);
    expect(response.message.content).toBe('Réponse après 500');
  });

  it('échec après les réessais (3 tentatives infructueuses)', async () => {
    let callCount = 0;
    const fakeFetch: typeof fetch = async () => {
      callCount++;
      throw new Error('Persistent network failure');
    };

    const client = new RodiumClient({
      apiKey: 'test-key',
      model: 'anthropic/claude-haiku-4-5-20251001',
      fetchFn: fakeFetch,
      retryDelayMs: 1,
    });

    await expect(
      client.chat({
        messages: [{ role: 'user', content: 'Salut' }],
      }),
    ).rejects.toThrow(LlmError);

    expect(callCount).toBe(3);
  });

  it('aucun retry sur une erreur 4xx (échec immédiat après 1 appel)', async () => {
    let callCount = 0;
    const fakeFetch: typeof fetch = async () => {
      callCount++;
      return new Response(
        JSON.stringify({
          error: { message: 'Invalid API Key or Bad Request' },
        }),
        { status: 401, headers: { 'Content-Type': 'application/json' } },
      );
    };

    const client = new RodiumClient({
      apiKey: 'test-key',
      model: 'anthropic/claude-haiku-4-5-20251001',
      fetchFn: fakeFetch,
      retryDelayMs: 1,
    });

    await expect(
      client.chat({
        messages: [{ role: 'user', content: 'Salut' }],
      }),
    ).rejects.toThrow(LlmError);

    // Must be called exactly once: NO RETRY on 4xx
    expect(callCount).toBe(1);
  });
});
