import 'dotenv/config';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { RodiumClient } from '../src/adapters/llm/rodium-client.js';
import { InMemoryStore } from '../src/adapters/store/in-memory-store.js';
import { evaluateReply } from '../src/agent/evaluation/index.js';
import type { AgentRunResult } from '../src/agent/loop.js';
import { createRunner, type RunnerMode, type TurnRunner } from '../src/agent/runners.js';
import type { ToolCallTraceEvent } from '../src/agent/trace.js';
import { INITIAL_PRODUCTS, INITIAL_ZONES } from '../src/domain/catalogue.js';
import { Shop } from '../src/domain/shop.js';
import { renderReport, type RunRecord } from '../src/metrics/compare.js';
import { estimateCostRodi } from '../src/metrics/cost.js';
import { getModelPrice } from '../src/metrics/model-prices.js';
import type { ApprovalDecision, ApprovalPort, ApprovalRequest } from '../src/ports/approval.js';
import {
  type ChatRequest,
  type ChatResponse,
  type LlmClient,
  LlmError,
} from '../src/ports/llm-client.js';
import { SCENARIOS, SCENARIOS_BY_ID, type Scenario } from '../eval/scenarios.js';

// Constante du sujet : estimation grossière issue des mesures du palier 1
export const APPROX_TOKENS_PER_CALL = 2600;

export class MaxGlobalLlmCallsReachedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MaxGlobalLlmCallsReachedError';
  }
}

/**
 * Client LLM enveloppant avec plafond GLOBAL pour l'ensemble de la comparaison.
 */
export class GlobalCappedLlmClient implements LlmClient {
  private totalCalls = 0;

  constructor(
    private readonly inner: LlmClient,
    public readonly maxGlobalCalls: number,
  ) {}

  public get callCount(): number {
    return this.totalCalls;
  }

  public async chat(request: ChatRequest): Promise<ChatResponse> {
    if (this.totalCalls >= this.maxGlobalCalls) {
      throw new MaxGlobalLlmCallsReachedError(
        `Arrêt immédiat : plafond global de ${this.maxGlobalCalls} appels LLM atteint (${this.totalCalls}/${this.maxGlobalCalls}).`,
      );
    }
    this.totalCalls++;
    return this.inner.chat(request);
  }
}

/**
 * Port d'approbation équitable qui REFUSE tout : aucune commande ne peut être créée.
 */
export const REFUSING_APPROVAL_PORT: ApprovalPort = {
  async request(_req: ApprovalRequest): Promise<ApprovalDecision> {
    return { approved: false, reason: 'Refus automatique en mode comparaison' };
  },
};

export interface CompareArgs {
  readonly scenarios: readonly Scenario[];
  readonly modes: readonly RunnerMode[];
  readonly runs: number;
  readonly maxLlmCalls: number;
  readonly resumePath?: string;
  readonly outFile: string;
  readonly dryRun: boolean;
  readonly withJudge: boolean;
}

export function parseCompareArgs(argv: readonly string[]): CompareArgs {
  let selectedScenarioIds: string[] = ['S1', 'S2', 'S3', 'K'];
  let selectedModes: RunnerMode[] = ['single', 'team'];

  let runs = process.env.npm_config_runs
    ? Math.max(1, Number.parseInt(process.env.npm_config_runs, 10) || 3)
    : 3;

  let maxLlmCalls = process.env.npm_config_max_llm_calls
    ? Math.max(1, Number.parseInt(process.env.npm_config_max_llm_calls, 10) || 150)
    : 150;

  let resumePath = process.env.npm_config_resume || undefined;
  let outFile =
    process.env.npm_config_out ||
    path.join('docs', 'comparaison-agent-seul-vs-equipe.md');

  let dryRun =
    process.env.npm_config_dry_run === 'true' ||
    process.env.npm_config_dry_run === '1' ||
    process.env.DRY_RUN === '1' ||
    false;

  let withJudge =
    process.env.npm_config_with_judge === 'true' ||
    process.env.npm_config_with_judge === '1' ||
    process.env.WITH_JUDGE === '1' ||
    false;

  if (process.env.npm_config_scenarios) {
    selectedScenarioIds = process.env.npm_config_scenarios
      .split(/[,\s]+/)
      .map((s) => s.trim())
      .filter(Boolean);
  }

  if (process.env.npm_config_modes) {
    const parsedModes = process.env.npm_config_modes
      .split(/[,\s]+/)
      .map((s) => s.trim().toLowerCase())
      .filter((s): s is RunnerMode => s === 'single' || s === 'team');
    if (parsedModes.length > 0) {
      selectedModes = parsedModes;
    }
  }

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg) continue;

    if (arg === '--dry-run') {
      dryRun = true;
    } else if (arg === '--with-judge') {
      withJudge = true;
    } else if (arg === '--runs' && i + 1 < argv.length) {
      const next = argv[++i];
      runs = Math.max(1, (next ? Number.parseInt(next, 10) : 3) || 3);
    } else if (arg.startsWith('--runs=')) {
      runs = Math.max(1, Number.parseInt(arg.slice('--runs='.length), 10) || 3);
    } else if (arg === '--max-llm-calls' && i + 1 < argv.length) {
      const next = argv[++i];
      maxLlmCalls = Math.max(1, (next ? Number.parseInt(next, 10) : 150) || 150);
    } else if (arg.startsWith('--max-llm-calls=')) {
      maxLlmCalls = Math.max(
        1,
        Number.parseInt(arg.slice('--max-llm-calls='.length), 10) || 150,
      );
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
    } else if (arg === '--modes' && i + 1 < argv.length) {
      const next = argv[++i];
      if (next) {
        const parsed = next
          .split(/[,\s]+/)
          .map((s) => s.trim().toLowerCase())
          .filter((s): s is RunnerMode => s === 'single' || s === 'team');
        if (parsed.length > 0) selectedModes = parsed;
      }
    } else if (arg.startsWith('--modes=')) {
      const parsed = arg
        .slice('--modes='.length)
        .split(/[,\s]+/)
        .map((s) => s.trim().toLowerCase())
        .filter((s): s is RunnerMode => s === 'single' || s === 'team');
      if (parsed.length > 0) selectedModes = parsed;
    } else if (arg === '--resume' && i + 1 < argv.length) {
      resumePath = argv[++i];
    } else if (arg.startsWith('--resume=')) {
      resumePath = arg.slice('--resume='.length);
    } else if (arg === '--out' && i + 1 < argv.length) {
      outFile = argv[++i] ?? outFile;
    } else if (arg.startsWith('--out=')) {
      outFile = arg.slice('--out='.length) || outFile;
    }
  }

  const resolvedScenarios: Scenario[] = [];
  for (const id of selectedScenarioIds) {
    const found = SCENARIOS_BY_ID.get(id);
    if (found) {
      resolvedScenarios.push(found);
    } else {
      console.warn(`[Avertissement] Scénario "${id}" inconnu, ignoré.`);
    }
  }

  const scenarios = resolvedScenarios.length > 0 ? resolvedScenarios : SCENARIOS;

  return {
    scenarios,
    modes: selectedModes,
    runs,
    maxLlmCalls,
    resumePath,
    outFile,
    dryRun,
    withJudge,
  };
}

export interface CompareDependencies {
  readonly llm?: LlmClient;
  readonly runnerFactory?: (
    mode: RunnerMode,
    llm: LlmClient,
    shop: Shop,
  ) => TurnRunner;
  readonly checkWalletFn?: (baseUrl: string, apiKey: string) => Promise<void>;
  readonly writeFileFn?: (filePath: string, content: string) => Promise<void> | void;
  readonly readFileFn?: (filePath: string) => Promise<string> | string;
  readonly fileExistsFn?: (filePath: string) => boolean;
  readonly log?: (msg: string) => void;
  readonly warn?: (msg: string) => void;
  readonly error?: (msg: string) => void;
  readonly exitProcess?: (code: number) => never | void;
  readonly now?: () => Date;
}

export interface CompareResult {
  readonly stoppedReason: 'completed' | 'dry_run' | 'insufficient_funds' | 'max_calls_reached';
  readonly jsonPath?: string;
  readonly outPath?: string;
  readonly records: readonly RunRecord[];
  readonly totalCallsConsumed: number;
}

async function defaultCheckWallet(baseUrl: string, apiKey: string, warn: (msg: string) => void, log: (msg: string) => void): Promise<void> {
  const walletUrl = `${baseUrl.replace(/\/+$/, '')}/wallet`;
  try {
    const res = await fetch(walletUrl, {
      method: 'GET',
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(5000),
    });
    if (res.ok) {
      const data = await res.json();
      log(`[Wallet] Solde disponible : ${JSON.stringify(data)}\n`);
    } else {
      warn(
        `[Avertissement] Impossible de lire le solde via ${walletUrl} (HTTP ${res.status} ${res.statusText}). Continuation...\n`,
      );
    }
  } catch (err) {
    warn(
      `[Avertissement] Erreur réseau lors de la consultation du solde wallet : ${err instanceof Error ? err.message : err}. Continuation...\n`,
    );
  }
}

export async function runCompareModes(
  argv: readonly string[],
  deps: CompareDependencies = {},
): Promise<CompareResult> {
  const log = deps.log ?? console.log;
  const warn = deps.warn ?? console.warn;
  const error = deps.error ?? console.error;
  const now = deps.now ?? (() => new Date());

  const args = parseCompareArgs(argv);

  // 1. Refuser sans LIVE=1, RODIUM_API_KEY et RODIUM_MODEL
  const liveEnv = process.env.LIVE;
  const apiKey = process.env.RODIUM_API_KEY || process.env.RODIUMAI_API_KEY;
  const model = process.env.RODIUM_MODEL || process.env.RODIUMAI_MODEL;

  if (liveEnv !== '1' || !apiKey || !model) {
    error('======================================================================');
    error('  EXÉCUTION REFUSÉE (GARDE-FOU BUDGÉTAIRE)');
    error('======================================================================');
    error('Le script de comparaison exige obligatoirement les variables d\'environnement suivantes :');
    error(`  - LIVE=1           (actuel : ${liveEnv ?? 'non défini'})`);
    error(`  - RODIUM_API_KEY   (actuel : ${apiKey ? 'défini' : 'MANQUANT'})`);
    error(`  - RODIUM_MODEL     (actuel : ${model ?? 'MANQUANT'})`);
    error('\nExemple d\'exécution autorisée en mode sécurisé :');
    error('  LIVE=1 npm run compare -- --dry-run');
    error('======================================================================');
    if (deps.exitProcess) {
      deps.exitProcess(1);
    }
    throw new Error('Variables obligatoires manquantes (LIVE=1, RODIUM_API_KEY, RODIUM_MODEL)');
  }

  // 2. Mode --dry-run : affiche le plan, plafond et dépense indicative puis s'arrête sans appel réseau
  if (args.dryRun) {
    const totalExecutions = args.scenarios.length * args.modes.length * args.runs;
    const price = getModelPrice(model);
    const promptTokens = Math.round(APPROX_TOKENS_PER_CALL * 0.9);
    const completionTokens = Math.round(APPROX_TOKENS_PER_CALL * 0.1);

    let costEstStr = 'non disponible (modèle inconnu)';
    if (price) {
      const callCost = estimateCostRodi(
        { promptTokens, completionTokens, totalTokens: APPROX_TOKENS_PER_CALL },
        price,
      ).totalRodi;
      const totalBudgetRodi = args.maxLlmCalls * callCost;
      costEstStr = `~${totalBudgetRodi.toFixed(4)} RODI (${callCost.toFixed(6)} RODI / appel typique)`;
    }

    log('='.repeat(70));
    log('  COMPARAISON AGENT SEUL VS ÉQUIPE — MODE SIMULATION (--dry-run)');
    log('='.repeat(70));
    log(`- Modèle cible         : ${model}`);
    log(`- Scénarios (${args.scenarios.length})     : ${args.scenarios.map((s) => s.id).join(', ')}`);
    log(`- Modes (${args.modes.length})         : ${args.modes.join(', ')}`);
    log(`- Essais par couple    : ${args.runs}`);
    log(`- Total d'exécutions   : ${totalExecutions}`);
    log(`- Plafond global LLM   : ${args.maxLlmCalls} appels max`);
    log(`- Budget indicatif     : ${costEstStr}`);
    log(`- Juge LLM             : ${args.withJudge ? 'activé (--with-judge)' : 'désactivé (forcé à off)'}`);
    log(`- Fichier de sortie    : ${args.outFile}`);
    log('='.repeat(70));
    log('Simulation terminée : aucun appel réseau n\'a été émis.');

    return {
      stoppedReason: 'dry_run',
      records: [],
      totalCallsConsumed: 0,
    };
  }

  // 3. Forcer JUDGE à off sauf si --with-judge
  process.env.JUDGE = args.withJudge ? 'on' : 'off';

  // 4. Consultation préventive du solde via GET /wallet
  const baseUrl = process.env.RODIUM_BASE_URL || 'https://api.rodium.ai';
  if (deps.checkWalletFn) {
    await deps.checkWalletFn(baseUrl, apiKey);
  } else {
    await defaultCheckWallet(baseUrl, apiKey, warn, log);
  }

  // 5. Instanciation du client LLM et du compteur global
  const rawLlm = deps.llm ?? new RodiumClient({ model, apiKey, baseUrl });
  const cappedLlm = new GlobalCappedLlmClient(rawLlm, args.maxLlmCalls);

  // 6. Gestion du fichier de sauvegarde et de reprise (--resume)
  const fileExists = deps.fileExistsFn ?? fs.existsSync;
  const readFile =
    deps.readFileFn ?? ((p: string) => fs.readFileSync(p, 'utf-8'));
  const writeFile =
    deps.writeFileFn ??
    ((p: string, c: string) => {
      const dir = path.dirname(p);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(p, c, 'utf-8');
    });

  const records: RunRecord[] = [];
  const currentDate = now();
  const dateStr = currentDate.toISOString().split('T')[0]!;
  const timestampStr = currentDate.toISOString().replace(/[:.]/g, '-');

  let jsonPath: string;
  if (args.resumePath) {
    jsonPath = args.resumePath;
    if (fileExists(jsonPath)) {
      try {
        const raw = await readFile(jsonPath);
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed.records)) {
          records.push(...parsed.records);
          log(`[Resume] ${records.length} exécutions rechargées depuis ${jsonPath}`);
        }
      } catch (err) {
        warn(`[Avertissement] Erreur de lecture de ${jsonPath} : ${err}. Poursuite...`);
      }
    } else {
      warn(`[Avertissement] Fichier de reprise ${jsonPath} introuvable. Nouveau fichier créé.`);
    }
  } else {
    jsonPath = path.join('docs', 'mesures', `compare-${timestampStr}.json`);
  }

  const outPath = args.outFile;
  const maxTurnLlmCalls = process.env.MAX_TOTAL_LLM_CALLS
    ? Math.max(1, Number.parseInt(process.env.MAX_TOTAL_LLM_CALLS, 10) || 20)
    : 20;

  const saveProgress = async () => {
    const jsonData = {
      timestamp: currentDate.toISOString(),
      model,
      runsPerScenario: args.runs,
      scenarios: args.scenarios.map((s) => s.id),
      modes: args.modes,
      maxTurnLlmCalls,
      maxGlobalLlmCalls: args.maxLlmCalls,
      totalCallsConsumed: cappedLlm.callCount,
      records,
    };
    await writeFile(jsonPath, JSON.stringify(jsonData, null, 2));

    const markdown = renderReport(records, {
      date: dateStr,
      model,
      runsPerScenario: args.runs,
      scenarios: args.scenarios.map((s) => s.id),
      judgeEnabled: args.withJudge,
      maxTurnLlmCalls,
      maxGlobalLlmCalls: args.maxLlmCalls,
      totalCallsConsumed: cappedLlm.callCount,
    });
    await writeFile(outPath, markdown);
  };

  // 7. Boucle d'exécution ordonnée
  for (const scenario of args.scenarios) {
    for (const mode of args.modes) {
      for (let runIndex = 1; runIndex <= args.runs; runIndex++) {
        const runKey = `${scenario.id}|${mode}|${runIndex}`;
        const alreadyDone = records.some(
          (r) => `${r.scenario}|${r.mode}|${r.run}` === runKey,
        );
        if (alreadyDone) {
          log(`[Skip] ${scenario.id} (${mode}, run ${runIndex}) déjà consigné.`);
          continue;
        }

        log(`\n[Run] Scénario ${scenario.id} — Mode: ${mode} — Essai ${runIndex}/${args.runs}`);

        const freshShop = new Shop(new InMemoryStore());

        const runner: TurnRunner = deps.runnerFactory
          ? deps.runnerFactory(mode, cappedLlm, freshShop)
          : createRunner({
              mode,
              llm: cappedLlm,
              shop: freshShop,
              approval: REFUSING_APPROVAL_PORT,
              maxTotalLlmCalls: maxTurnLlmCalls,
              // Le juge est contrôlé via process.env.JUDGE défini plus haut
            });

        const startTime = Date.now();
        let runResult: AgentRunResult;
        let executionError: string | undefined;

        try {
          runResult = await runner({ userMessage: scenario.userMessage });
        } catch (err) {
          // Erreur LlmError 402 ou 429 : arrêt propre immédiat
          if (err instanceof LlmError && (err.status === 402 || err.status === 429)) {
            await saveProgress();
            error(
              `\nsolde insuffisant : recharge puis relance avec --resume ${jsonPath}`,
            );
            return {
              stoppedReason: 'insufficient_funds',
              jsonPath,
              outPath,
              records,
              totalCallsConsumed: cappedLlm.callCount,
            };
          }

          // Plafond global LLM atteint : arrêt propre
          if (err instanceof MaxGlobalLlmCallsReachedError) {
            await saveProgress();
            error(`\n${err.message}`);
            return {
              stoppedReason: 'max_calls_reached',
              jsonPath,
              outPath,
              records,
              totalCallsConsumed: cappedLlm.callCount,
            };
          }

          // Autre erreur ordinaire : consigner et continuer
          executionError = err instanceof Error ? err.message : String(err);
          runResult = {
            reply: '',
            llmCalls: 0,
            usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
            trace: [],
            stopReason: 'evaluation_failed',
            steps: 0,
            messages: [],
            evaluationRetries: 0,
            durationMs: 0,
            toolNames: [],
          };
        }

        const durationMs = Date.now() - startTime;

        // Double évaluation : check() scénario + evaluateReply()
        const scenarioCheck = scenario.check(runResult);
        const codeVerdict = evaluateReply({
          userMessage: scenario.userMessage,
          reply: runResult.reply,
          trace: runResult.trace,
          catalogue: INITIAL_PRODUCTS,
        });

        const reasons: string[] = [];
        if (!scenarioCheck.ok) {
          reasons.push(...scenarioCheck.reasons);
        }
        if (!codeVerdict.ok) {
          reasons.push(...codeVerdict.violations.map((v) => v.critique));
        }
        if (runResult.stopReason !== 'answered') {
          if (!reasons.some((r) => r.includes(runResult.stopReason))) {
            reasons.push(`Statut d'arrêt : ${runResult.stopReason}`);
          }
        }

        const isOk =
          scenarioCheck.ok &&
          codeVerdict.ok &&
          runResult.stopReason === 'answered' &&
          !executionError;

        const evaluationRetries = runResult.trace.filter((e) => e.type === 'retry').length;
        const judgeErrors = runResult.trace.filter((e) => e.type === 'judge_error').length;
        const toolNames = runResult.trace
          .filter((e): e is ToolCallTraceEvent => e.type === 'tool_call')
          .map((e) => e.name);

        const replyExcerpt = runResult.reply
          ? runResult.reply.length > 200
            ? runResult.reply.slice(0, 197) + '...'
            : runResult.reply
          : '';

        const record: RunRecord = {
          scenario: scenario.id,
          mode,
          run: runIndex,
          ok: isOk,
          reasons,
          stopReason: executionError ? 'error' : runResult.stopReason,
          llmCalls: runResult.llmCalls,
          promptTokens: runResult.usage.promptTokens,
          completionTokens: runResult.usage.completionTokens,
          durationMs,
          evaluationRetries,
          judgeErrors,
          toolNames,
          replyExcerpt,
          error: executionError,
        };

        records.push(record);
        await saveProgress();
        log(`  → Résultat: ${isOk ? 'OK' : 'NON CONFORME'} (${runResult.llmCalls} appels, ${durationMs} ms)`);
      }
    }
  }

  log('\n' + '='.repeat(70));
  log('  COMPARAISON TERMINÉE AVEC SUCCÈS');
  log('='.repeat(70));
  log(`- Données brutes : ${jsonPath}`);
  log(`- Rapport final  : ${outPath}`);
  log(`- Appels LLM     : ${cappedLlm.callCount} / ${args.maxLlmCalls}`);

  return {
    stoppedReason: 'completed',
    jsonPath,
    outPath,
    records,
    totalCallsConsumed: cappedLlm.callCount,
  };
}

// Point d'entrée direct en ligne de commande
if (
  process.argv[1] &&
  (process.argv[1].endsWith('compare-modes.ts') ||
    process.argv[1].endsWith('compare-modes.js'))
) {
  runCompareModes(process.argv.slice(2)).catch((err) => {
    console.error('Erreur inattendue lors de la comparaison :', err);
    process.exit(1);
  });
}
