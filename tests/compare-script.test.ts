import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FakeLlm } from '../src/adapters/llm/fake-llm.js';
import type { AgentRunResult } from '../src/agent/loop.js';
import type { TurnRunner } from '../src/agent/runners.js';
import { type ChatResponse, LlmError } from '../src/ports/llm-client.js';
import {
  GlobalCappedLlmClient,
  MaxGlobalLlmCallsReachedError,
  parseCompareArgs,
  runCompareModes,
} from '../scripts/compare-modes.js';

describe('Script de comparaison plafonné (scripts/compare-modes.ts)', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
    process.env.LIVE = '1';
    process.env.RODIUM_API_KEY = 'fake-test-key';
    process.env.RODIUM_MODEL = 'google/gemini-2.5-flash';
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  describe('parseCompareArgs()', () => {
    it('applique les valeurs par défaut conformes au sujet', () => {
      const args = parseCompareArgs([]);
      expect(args.scenarios.map((s) => s.id)).toEqual(['S1', 'S2', 'S3', 'K']);
      expect(args.modes).toEqual(['single', 'team']);
      expect(args.runs).toBe(3);
      expect(args.maxLlmCalls).toBe(150);
      expect(args.outFile).toContain('comparaison-agent-seul-vs-equipe.md');
      expect(args.dryRun).toBe(false);
      expect(args.withJudge).toBe(false);
    });

    it('parse les arguments personnalisés (--runs, --max-llm-calls, --scenarios, --modes, --dry-run)', () => {
      const args = parseCompareArgs([
        '--scenarios',
        'S1,K',
        '--modes',
        'single',
        '--runs',
        '2',
        '--max-llm-calls',
        '40',
        '--dry-run',
        '--with-judge',
        '--out',
        'custom/report.md',
      ]);
      expect(args.scenarios.map((s) => s.id)).toEqual(['S1', 'K']);
      expect(args.modes).toEqual(['single']);
      expect(args.runs).toBe(2);
      expect(args.maxLlmCalls).toBe(40);
      expect(args.dryRun).toBe(true);
      expect(args.withJudge).toBe(true);
      expect(args.outFile).toBe('custom/report.md');
    });
  });

  describe('GlobalCappedLlmClient', () => {
    it('arrête immédiatement quand le plafond global maxGlobalCalls est atteint', async () => {
      const dummyRes: ChatResponse = {
        message: { role: 'assistant', content: 'test' },
        usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
        model: 'test',
      };
      const fakeLlm = new FakeLlm([dummyRes, dummyRes]);
      const capped = new GlobalCappedLlmClient(fakeLlm, 1);

      const r1 = await capped.chat({ messages: [] });
      expect(r1.message.content).toBe('test');
      expect(capped.callCount).toBe(1);

      await expect(capped.chat({ messages: [] })).rejects.toThrow(
        MaxGlobalLlmCallsReachedError,
      );
    });
  });

  describe('runCompareModes() avec runners injectés', () => {
    function makeSuccessfulRunResult(userMessage: string): AgentRunResult {
      // Pour S1
      if (userMessage.includes('pagnes')) {
        return {
          reply: 'Le Pagne wax 6 yards est disponible à 12 000 FCFA, soit 18,29 EUR.',
          llmCalls: 3,
          usage: { promptTokens: 300, completionTokens: 50, totalTokens: 350 },
          trace: [
            {
              type: 'tool_call',
              name: 'chercher_produits',
              arguments: { mot_cle: 'pagne' },
              result: {
                produits: [
                  {
                    ref: 'P01',
                    nom: 'Pagne wax 6 yards',
                    categorie: 'tissu',
                    prix_fcfa: 12000,
                  },
                ],
              },
              step: 1,
              agent: 'agent',
              durationMs: 10,
            },
            {
              type: 'tool_call',
              name: 'verifier_stock',
              arguments: { ref: 'P01' },
              result: { ref: 'P01', stock: 14, disponible: true },
              step: 2,
              agent: 'agent',
              durationMs: 10,
            },
            {
              type: 'tool_call',
              name: 'convertir_devise',
              arguments: { montant_fcfa: 12000, devise: 'EUR' },
              result: { montant_fcfa: 12000, devise: 'EUR', montant_converti: 18.29 },
              step: 3,
              agent: 'agent',
              durationMs: 10,
            },
          ],
          stopReason: 'answered',
          steps: 4,
          messages: [],
          evaluationRetries: 0,
          durationMs: 50,
          toolNames: ['chercher_produits', 'verifier_stock', 'convertir_devise'],
        };
      }

      // Défaut
      return {
        reply: 'Réponse générique conforme.',
        llmCalls: 2,
        usage: { promptTokens: 100, completionTokens: 20, totalTokens: 120 },
        trace: [],
        stopReason: 'answered',
        steps: 2,
        messages: [],
        evaluationRetries: 0,
        durationMs: 30,
        toolNames: [],
      };
    }

    it('produit le rapport et le JSON avec les exécutions programmées', async () => {
      const writtenFiles = new Map<string, string>();
      const logs: string[] = [];

      const mockRunner: TurnRunner = async (params) => {
        return makeSuccessfulRunResult(params.userMessage);
      };

      const result = await runCompareModes(
        ['--scenarios', 'S1', '--modes', 'single', '--runs', '2'],
        {
          writeFileFn: (p, c) => {
            writtenFiles.set(p, c);
          },
          runnerFactory: () => mockRunner,
          checkWalletFn: async () => {},
          log: (m) => logs.push(m),
        },
      );

      expect(result.stoppedReason).toBe('completed');
      expect(result.records).toHaveLength(2);

      // Le JSON et le rapport Markdown ont été écrits
      expect(result.jsonPath).toBeDefined();
      expect(writtenFiles.has(result.jsonPath!)).toBe(true);
      expect(writtenFiles.has(result.outPath!)).toBe(true);

      const jsonContent = JSON.parse(writtenFiles.get(result.jsonPath!)!);
      expect(jsonContent.records).toHaveLength(2);
      expect(jsonContent.records[0].scenario).toBe('S1');
      expect(jsonContent.records[0].ok).toBe(true);

      const mdContent = writtenFiles.get(result.outPath!)!;
      expect(mdContent).toContain('## 2. Tableau comparatif du sujet');
      expect(mdContent).toContain('Réponses correctes (/3)');
    });

    it('--resume saute les exécutions déjà faites et complète le reste', async () => {
      const existingRecords = [
        {
          scenario: 'S1',
          mode: 'single',
          run: 1,
          ok: true,
          reasons: [],
          stopReason: 'answered',
          llmCalls: 3,
          promptTokens: 300,
          completionTokens: 50,
          durationMs: 100,
          evaluationRetries: 0,
          judgeErrors: 0,
          toolNames: ['chercher_produits', 'convertir_devise'],
          replyExcerpt: 'ok',
        },
      ];

      const writtenFiles = new Map<string, string>();
      const callsExecuted: string[] = [];

      const mockRunner: TurnRunner = async (params) => {
        callsExecuted.push(params.userMessage);
        return makeSuccessfulRunResult(params.userMessage);
      };

      const result = await runCompareModes(
        [
          '--scenarios',
          'S1',
          '--modes',
          'single',
          '--runs',
          '2',
          '--resume',
          'docs/mesures/fake.json',
        ],
        {
          fileExistsFn: () => true,
          readFileFn: () => JSON.stringify({ records: existingRecords }),
          writeFileFn: (p, c) => {
            writtenFiles.set(p, c);
          },
          runnerFactory: () => mockRunner,
          checkWalletFn: async () => {},
        },
      );

      // Seulement le run 2 a été exécuté (le run 1 a été sauté)
      expect(callsExecuted).toHaveLength(1);
      // Total de records après reprise = 2 (le 1 existant + le 2 nouveau)
      expect(result.records).toHaveLength(2);
    });

    it('plafond global atteint -> arrêt immédiat avec sauvegarde de l\'état courant', async () => {
      const writtenFiles = new Map<string, string>();
      const errorsLogged: string[] = [];

      // Un runner qui lève MaxGlobalLlmCallsReachedError au 2ème tour
      let callCount = 0;
      const mockRunner: TurnRunner = async (params) => {
        callCount++;
        if (callCount >= 2) {
          throw new MaxGlobalLlmCallsReachedError('Arrêt immédiat : plafond global atteint.');
        }
        return makeSuccessfulRunResult(params.userMessage);
      };

      const result = await runCompareModes(
        ['--scenarios', 'S1', '--modes', 'single', '--runs', '3', '--max-llm-calls', '2'],
        {
          writeFileFn: (p, c) => {
            writtenFiles.set(p, c);
          },
          runnerFactory: () => mockRunner,
          checkWalletFn: async () => {},
          error: (m) => errorsLogged.push(m),
        },
      );

      expect(result.stoppedReason).toBe('max_calls_reached');
      // Le premier run a été sauvegardé avant l'arrêt
      expect(result.records).toHaveLength(1);
      expect(writtenFiles.has(result.jsonPath!)).toBe(true);
    });

    it('LlmError 402 -> arrêt propre et message solde insuffisant', async () => {
      const writtenFiles = new Map<string, string>();
      const errorsLogged: string[] = [];

      const mockRunner: TurnRunner = async () => {
        throw new LlmError(402, 'Solde épuisé');
      };

      const result = await runCompareModes(
        ['--scenarios', 'S1', '--modes', 'single', '--runs', '1'],
        {
          writeFileFn: (p, c) => {
            writtenFiles.set(p, c);
          },
          runnerFactory: () => mockRunner,
          checkWalletFn: async () => {},
          error: (m) => errorsLogged.push(m),
        },
      );

      expect(result.stoppedReason).toBe('insufficient_funds');
      expect(
        errorsLogged.some((msg) =>
          msg.includes('solde insuffisant : recharge puis relance avec --resume'),
        ),
      ).toBe(true);
      expect(writtenFiles.has(result.jsonPath!)).toBe(true);
    });

    it('erreur ordinaire sur une exécution : consignée dans RunRecord.error sans interrompre la comparaison', async () => {
      const writtenFiles = new Map<string, string>();
      let executionCount = 0;

      const mockRunner: TurnRunner = async (params) => {
        executionCount++;
        if (executionCount === 1) {
          throw new Error('Timeout temporaire');
        }
        return makeSuccessfulRunResult(params.userMessage);
      };

      const result = await runCompareModes(
        ['--scenarios', 'S1', '--modes', 'single', '--runs', '2'],
        {
          writeFileFn: (p, c) => {
            writtenFiles.set(p, c);
          },
          runnerFactory: () => mockRunner,
          checkWalletFn: async () => {},
        },
      );

      expect(result.stoppedReason).toBe('completed');
      expect(result.records).toHaveLength(2);

      // Le premier run a consigné l'erreur et ok === false
      expect(result.records[0]?.ok).toBe(false);
      expect(result.records[0]?.error).toBe('Timeout temporaire');
      expect(result.records[0]?.stopReason).toBe('error');

      // Le deuxième run a réussi
      expect(result.records[1]?.ok).toBe(true);
      expect(result.records[1]?.error).toBeUndefined();
    });

    it('refuse d\'exécuter si LIVE != 1', async () => {
      process.env.LIVE = '0';
      await expect(
        runCompareModes([], {
          exitProcess: () => {},
        }),
      ).rejects.toThrow('Variables obligatoires manquantes');
    });

    it('--dry-run s\'arrête immédiatement sans aucun appel réseau', async () => {
      let walletChecked = false;
      let runnerCalled = false;
      const logs: string[] = [];

      const result = await runCompareModes(['--dry-run'], {
        checkWalletFn: async () => {
          walletChecked = true;
        },
        runnerFactory: () => async () => {
          runnerCalled = true;
          return makeSuccessfulRunResult('');
        },
        log: (m) => logs.push(m),
      });

      expect(result.stoppedReason).toBe('dry_run');
      expect(walletChecked).toBe(false);
      expect(runnerCalled).toBe(false);
      expect(logs.some((l) => l.includes('MODE SIMULATION (--dry-run)'))).toBe(true);
    });
  });
});
