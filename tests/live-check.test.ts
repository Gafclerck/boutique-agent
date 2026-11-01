import { describe, expect, it } from 'vitest';
import { FakeLlm } from '../src/adapters/llm/fake-llm.js';
import type { ChatResponse } from '../src/ports/llm-client.js';
import {
  CappedLlmClient,
  MaxLlmCallsReachedError,
  parseArgs,
} from '../scripts/live-check.js';
import { SCENARIOS } from './scenarios/scenarios.js';

describe('Script live-check : Parseur d\'arguments et client plafonné', () => {
  describe('parseArgs()', () => {
    it('applique les valeurs par défaut (tous les scénarios, 1 run, 20 max calls, dryRun false)', () => {
      const parsed = parseArgs([]);
      expect(parsed.scenarios).toHaveLength(SCENARIOS.length);
      expect(parsed.runs).toBe(1);
      expect(parsed.maxLlmCalls).toBe(20);
      expect(parsed.dryRun).toBe(false);
    });

    it('analyse correctement les arguments complets avec séparateurs standards', () => {
      const parsed = parseArgs([
        '--scenarios',
        'S1,S3',
        '--runs',
        '3',
        '--max-llm-calls',
        '15',
        '--dry-run',
      ]);
      expect(parsed.scenarios.map((s) => s.id)).toEqual(['S1', 'S3']);
      expect(parsed.runs).toBe(3);
      expect(parsed.maxLlmCalls).toBe(15);
      expect(parsed.dryRun).toBe(true);
    });

    it('analyse correctement la syntaxe avec signe égal (--arg=valeur)', () => {
      const parsed = parseArgs([
        '--scenarios=a,c',
        '--runs=5',
        '--max-llm-calls=8',
      ]);
      expect(parsed.scenarios.map((s) => s.id)).toEqual(['a', 'c']);
      expect(parsed.runs).toBe(5);
      expect(parsed.maxLlmCalls).toBe(8);
      expect(parsed.dryRun).toBe(false);
    });
  });

  describe('CappedLlmClient', () => {
    const dummyResponse: ChatResponse = {
      message: { role: 'assistant', content: 'Bonjour' },
      usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
      model: 'test-model',
    };

    it('permet les appels tant que le plafond n\'est pas atteint et incrémente callCount', async () => {
      const fakeLlm = new FakeLlm([dummyResponse, dummyResponse]);
      const capped = new CappedLlmClient(fakeLlm, 2);

      expect(capped.callCount).toBe(0);
      const res1 = await capped.chat({ messages: [] });
      expect(res1.message.content).toBe('Bonjour');
      expect(capped.callCount).toBe(1);

      const res2 = await capped.chat({ messages: [] });
      expect(res2.message.content).toBe('Bonjour');
      expect(capped.callCount).toBe(2);
    });

    it('lève MaxLlmCallsReachedError dès que le plafond maxCalls est atteint', async () => {
      const fakeLlm = new FakeLlm([dummyResponse, dummyResponse]);
      const capped = new CappedLlmClient(fakeLlm, 1);

      await capped.chat({ messages: [] });
      expect(capped.callCount).toBe(1);

      await expect(capped.chat({ messages: [] })).rejects.toThrow(
        MaxLlmCallsReachedError,
      );
    });
  });
});
