import 'dotenv/config';
import { RodiumClient } from '../src/adapters/llm/rodium-client.js';
import {
  createRunner,
  resolveRunnerMode,
  type RunnerMode,
} from '../src/agent/runners.js';
import { type AgentRunResult } from '../src/agent/loop.js';
import { Shop } from '../src/domain/shop.js';
import type { ChatRequest, ChatResponse, LlmClient } from '../src/ports/llm-client.js';
import {
  type Scenario,
  SCENARIOS,
  SCENARIOS_BY_ID,
} from '../tests/scenarios/scenarios.js';

export class MaxLlmCallsReachedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MaxLlmCallsReachedError';
  }
}

export class CappedLlmClient implements LlmClient {
  private totalCalls = 0;

  constructor(
    private readonly inner: LlmClient,
    public readonly maxCalls: number,
  ) {}

  public get callCount(): number {
    return this.totalCalls;
  }

  public async chat(request: ChatRequest): Promise<ChatResponse> {
    if (this.totalCalls >= this.maxCalls) {
      throw new MaxLlmCallsReachedError(
        `Arrêt immédiat : plafond global de ${this.maxCalls} appels LLM atteint (${this.totalCalls}/${this.maxCalls}).`,
      );
    }
    this.totalCalls++;
    return this.inner.chat(request);
  }
}

interface CliArgs {
  readonly scenarios: readonly Scenario[];
  readonly runs: number;
  readonly maxLlmCalls: number;
  readonly dryRun: boolean;
  readonly mode: RunnerMode;
}

export function parseArgs(argv: readonly string[]): CliArgs {
  let selectedScenarioIds: string[] = [];
  let runs = process.env.npm_config_runs
    ? Math.max(1, Number.parseInt(process.env.npm_config_runs, 10) || 1)
    : 1;
  let maxLlmCalls = process.env.npm_config_max_llm_calls
    ? Math.max(1, Number.parseInt(process.env.npm_config_max_llm_calls, 10) || 20)
    : 20;
  let dryRun =
    process.env.npm_config_dry_run === 'true' ||
    process.env.npm_config_dry_run === '1' ||
    process.env.DRY_RUN === '1' ||
    false;

  const mode = resolveRunnerMode(argv);

  if (process.env.npm_config_scenarios) {
    selectedScenarioIds = process.env.npm_config_scenarios
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  }

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg) continue;
    if (arg === '--dry-run') {
      dryRun = true;
    } else if (arg === '--runs' && i + 1 < argv.length) {
      const next = argv[++i];
      runs = Math.max(1, (next ? Number.parseInt(next, 10) : 1) || 1);
    } else if (arg.startsWith('--runs=')) {
      runs = Math.max(1, Number.parseInt(arg.slice('--runs='.length), 10) || 1);
    } else if (arg === '--max-llm-calls' && i + 1 < argv.length) {
      const next = argv[++i];
      maxLlmCalls = Math.max(1, (next ? Number.parseInt(next, 10) : 20) || 20);
    } else if (arg.startsWith('--max-llm-calls=')) {
      maxLlmCalls = Math.max(1, Number.parseInt(arg.slice('--max-llm-calls='.length), 10) || 20);
    } else if (arg === '--scenarios' && i + 1 < argv.length) {
      const next = argv[++i];
      if (next) {
        selectedScenarioIds = next.split(/[,\s]+/).map((s) => s.trim()).filter(Boolean);
      }
    } else if (arg.startsWith('--scenarios=')) {
      selectedScenarioIds = arg
        .slice('--scenarios='.length)
        .split(/[,\s]+/)
        .map((s) => s.trim())
        .filter(Boolean);
    }
  }

  let scenarios: readonly Scenario[];
  if (selectedScenarioIds.length > 0) {
    const resolved: Scenario[] = [];
    for (const id of selectedScenarioIds) {
      const found = SCENARIOS_BY_ID.get(id);
      if (found) {
        resolved.push(found);
      } else {
        console.warn(`[Avertissement] Scénario "${id}" inconnu, ignoré.`);
      }
    }
    scenarios = resolved.length > 0 ? resolved : SCENARIOS;
  } else {
    scenarios = SCENARIOS;
  }

  return { scenarios, runs, maxLlmCalls, dryRun, mode };
}

interface ScenarioRunStats {
  attempts: number;
  successes: number;
  totalLlmCalls: number;
  totalTokens: number;
}

async function checkWalletBalance(baseUrl: string, apiKey: string): Promise<void> {
  const walletUrl = `${baseUrl.replace(/\/+$/, '')}/wallet`;
  try {
    const response = await fetch(walletUrl, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
      signal: AbortSignal.timeout(5000),
    });

    if (response.ok) {
      const data = await response.json();
      console.log(`[Wallet] Solde disponible : ${JSON.stringify(data)}\n`);
    } else {
      console.warn(
        `[Avertissement] Impossible de lire le solde via ${walletUrl} (HTTP ${response.status} ${response.statusText}). Continuation...\n`,
      );
    }
  } catch (err) {
    console.warn(
      `[Avertissement] Erreur réseau lors de la consultation du solde wallet : ${err instanceof Error ? err.message : err}. Continuation...\n`,
    );
  }
}

export async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  // 1. Refuser d'exécuter sans LIVE=1, RODIUM_API_KEY et RODIUM_MODEL
  const liveEnv = process.env.LIVE;
  const apiKey = process.env.RODIUM_API_KEY || process.env.RODIUMAI_API_KEY;
  const model = process.env.RODIUM_MODEL || process.env.RODIUMAI_MODEL;

  if (liveEnv !== '1' || !apiKey || !model) {
    console.error('======================================================================');
    console.error('  EXÉCUTION REFUSÉE (GARDE-FOU BUDGÉTAIRE)');
    console.error('======================================================================');
    console.error('Le script live exige obligatoirement les variables d\'environnement suivantes :');
    console.error(`  - LIVE=1           (actuel : ${liveEnv ?? 'non défini'})`);
    console.error(`  - RODIUM_API_KEY   (actuel : ${apiKey ? 'défini' : 'MANQUANT'})`);
    console.error(`  - RODIUM_MODEL     (actuel : ${model ?? 'MANQUANT'})`);
    console.error('\nExemple d\'exécution autorisée en mode sécurisé :');
    console.error('  LIVE=1 npm run live -- --dry-run');
    console.error('======================================================================');
    process.exit(1);
  }

  // 2. Afficher le plan et le nombre estimé d'appels LLM
  const totalRuns = args.scenarios.length * args.runs;
  const estimatedCallsPerRun = 3;
  const estimatedTotalCalls = Math.min(totalRuns * estimatedCallsPerRun, args.maxLlmCalls);

  console.log('='.repeat(70));
  console.log('  PLAN D\'EXÉCUTION DU TEST LIVE PLAFONNÉ');
  console.log('='.repeat(70));
  console.log(`- Modèle cible         : ${model}`);
  console.log(`- Mode                 : ${args.mode.toUpperCase()}`);
  console.log(`- Scénarios (${args.scenarios.length})     : ${args.scenarios.map((s) => s.id).join(', ')}`);
  console.log(`- Essais par scénario  : ${args.runs}`);
  console.log(`- Total des exécutions : ${totalRuns}`);
  console.log(`- Plafond d'appels LLM : ${args.maxLlmCalls} max`);
  console.log(`- Appels LLM estimés   : ~${totalRuns * estimatedCallsPerRun} (plafonné à ~${estimatedTotalCalls})`);
  console.log(`- Type d'exécution     : ${args.dryRun ? 'DRY-RUN (aucun appel réseau)' : 'LIVE (appels réels)'}`);
  console.log('='.repeat(70) + '\n');

  // En --dry-run, s'arrête là sans aucun appel réseau
  if (args.dryRun) {
    console.log('[DRY-RUN] Vérification terminée avec succès. Aucun appel réseau effectué.');
    return;
  }

  // 3. Lire le solde via GET {baseUrl}/wallet
  const baseUrl =
    process.env.RODIUM_BASE_URL ||
    process.env.RODIUMAI_BASE_URL ||
    'https://api.rodiumai.io/v1';
  await checkWalletBalance(baseUrl, apiKey);

  // 4. Initialisation du client LLM avec compteur plafonné
  const underlyingLlm = new RodiumClient({
    apiKey,
    model,
    baseUrl,
  });
  const cappedLlm = new CappedLlmClient(underlyingLlm, args.maxLlmCalls);

  const statsMap = new Map<string, ScenarioRunStats>();
  for (const s of args.scenarios) {
    statsMap.set(s.id, {
      attempts: 0,
      successes: 0,
      totalLlmCalls: 0,
      totalTokens: 0,
    });
  }

  let stoppedEarly = false;
  let earlyStopReason = '';

  for (const scenario of args.scenarios) {
    if (stoppedEarly) break;
    const stats = statsMap.get(scenario.id)!;

    for (let runIndex = 1; runIndex <= args.runs; runIndex++) {
      const shop = new Shop();

      let result: AgentRunResult | undefined;
      try {
        const runner = createRunner({
          mode: args.mode,
          llm: cappedLlm,
          shop: () => shop,
          judgeClientFactory: () =>
            new RodiumClient({
              apiKey,
              model: process.env.JUDGE_MODEL || model,
              baseUrl,
            }),
        });
        result = await runner({
          userMessage: scenario.userMessage,
        });
      } catch (err) {
        if (err instanceof MaxLlmCallsReachedError) {
          stoppedEarly = true;
          earlyStopReason = err.message;
          console.error(`\n[STOP] ${err.message}`);
          break;
        }
        console.error(
          `\n[ERREUR] Scénario ${scenario.id} essai ${runIndex}/${args.runs} a échoué avec une exception :`,
          err instanceof Error ? err.message : err,
        );
        stats.attempts++;
        continue;
      }

      stats.attempts++;
      stats.totalLlmCalls += result.llmCalls;
      const runTokens =
        result.usage.totalTokens ??
        result.usage.promptTokens + result.usage.completionTokens;
      stats.totalTokens += runTokens;

      const verdict = scenario.check(result);
      if (verdict.ok) {
        stats.successes++;
        console.log(
          `[${scenario.id}] Essai ${runIndex}/${args.runs} : OK (${result.llmCalls} appels LLM, ${runTokens} tokens)`,
        );
      } else {
        console.log(
          `[${scenario.id}] Essai ${runIndex}/${args.runs} : ÉCHEC (${result.llmCalls} appels LLM, ${runTokens} tokens)`,
        );
        for (const reason of verdict.reasons) {
          console.log(`    - Raison : ${reason}`);
        }
      }
    }
  }

  // 5. Tableau récapitulatif
  console.log('\n' + '='.repeat(70));
  console.log('  RÉSULTATS DE LA VÉRIFICATION LIVE');
  console.log('='.repeat(70));
  console.log(
    'Scénario'.padEnd(12) +
      'Réussites/Essais'.padEnd(20) +
      'Appels LLM (moy.)'.padEnd(20) +
      'Tokens (moy.)',
  );
  console.log('-'.repeat(70));

  for (const scenario of args.scenarios) {
    const stats = statsMap.get(scenario.id)!;
    const ratio = `${stats.successes}/${stats.attempts}`;
    const avgCalls =
      stats.attempts > 0 ? (stats.totalLlmCalls / stats.attempts).toFixed(1) : '-';
    const avgTokens =
      stats.attempts > 0 ? Math.round(stats.totalTokens / stats.attempts).toLocaleString('fr-FR') : '-';

    console.log(
      scenario.id.padEnd(12) +
        ratio.padEnd(20) +
        avgCalls.padEnd(20) +
        avgTokens,
    );
  }

  console.log('-'.repeat(70));
  console.log(`Appels LLM totaux consommés : ${cappedLlm.callCount} / ${args.maxLlmCalls}`);
  if (stoppedEarly) {
    console.log(`Attention : l'évaluation a été interrompue prématurément : ${earlyStopReason}`);
  }
  console.log('='.repeat(70) + '\n');
}

// Exécuter uniquement si appelé directement en CLI
if (
  process.argv[1] &&
  (process.argv[1].endsWith('live-check.ts') || process.argv[1].endsWith('live-check.js'))
) {
  main().catch((err) => {
    console.error('Erreur inattendue :', err);
    process.exit(1);
  });
}
