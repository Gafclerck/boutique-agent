import 'dotenv/config';
import { RodiumClient } from '../src/adapters/llm/rodium-client.js';
import { createJudgeEvaluator } from '../src/agent/evaluation/index.js';
import type { ToolCallTraceEvent } from '../src/agent/trace.js';
import { INITIAL_PRODUCTS } from '../src/domain/catalogue.js';
import type { ChatRequest, ChatResponse, LlmClient } from '../src/ports/llm-client.js';
import { JUDGE_CASES, type JudgeCase } from '../tests/judge-cases.js';

export class MaxJudgeCallsReachedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MaxJudgeCallsReachedError';
  }
}

export class CappedJudgeLlmClient implements LlmClient {
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
      throw new MaxJudgeCallsReachedError(
        `Arrêt immédiat : plafond de ${this.maxCalls} appels LLM atteint (${this.totalCalls}/${this.maxCalls}).`,
      );
    }
    this.totalCalls++;
    return this.inner.chat(request);
  }
}

export interface CalibrationArgs {
  readonly dryRun: boolean;
  readonly maxLlmCalls: number;
}

export function parseCalibrationArgs(argv: readonly string[]): CalibrationArgs {
  let dryRun =
    process.env.npm_config_dry_run === 'true' ||
    process.env.npm_config_dry_run === '1' ||
    process.env.DRY_RUN === '1' ||
    false;

  let maxLlmCalls = process.env.npm_config_max_llm_calls
    ? Math.max(1, Number.parseInt(process.env.npm_config_max_llm_calls, 10) || 12)
    : 12;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg) continue;
    if (arg === '--dry-run') {
      dryRun = true;
    } else if (arg === '--max-llm-calls' && i + 1 < argv.length) {
      const next = argv[++i];
      maxLlmCalls = Math.max(1, (next ? Number.parseInt(next, 10) : 12) || 12);
    } else if (arg.startsWith('--max-llm-calls=')) {
      maxLlmCalls = Math.max(
        1,
        Number.parseInt(arg.slice('--max-llm-calls='.length), 10) || 12,
      );
    }
  }

  return { dryRun, maxLlmCalls };
}

export async function runCalibration(argv: readonly string[] = process.argv.slice(2)): Promise<void> {
  const args = parseCalibrationArgs(argv);

  const model =
    process.env.JUDGE_MODEL ||
    process.env.RODIUM_MODEL ||
    'anthropic/claude-haiku-4-5-20251001';

  // 1. In dry-run mode: display plan and exit immediately (without demanding LIVE=1 or API keys)
  if (args.dryRun) {
    console.log('\n' + '='.repeat(70));
    console.log('  CALIBRATION DU JUGE LLM — MODE SIMULATION (--dry-run)');
    console.log('='.repeat(70));
    console.log(`Modèle cible      : ${model}`);
    const okCount = JUDGE_CASES.filter((c) => c.expected === 'ok').length;
    const pasEncoreCount = JUDGE_CASES.filter((c) => c.expected === 'pas_encore').length;
    console.log(`Nombre de cas     : ${JUDGE_CASES.length} cas de calibration (${okCount} "ok", ${pasEncoreCount} "pas_encore")`);
    console.log(`Appels LLM prévus : ${JUDGE_CASES.length} appels`);
    console.log(`Plafond maxCalls  : ${args.maxLlmCalls} appels`);
    console.log('-'.repeat(70));
    console.log('Plan des cas de calibration :');
    JUDGE_CASES.forEach((c, index) => {
      console.log(
        `  ${index + 1}. [${c.id}] (attendu : ${c.expected.padEnd(10)}) - ${c.description}`,
      );
    });
    console.log('-'.repeat(70));
    console.log('Simulation terminée : aucun appel réel n\'a été émis.');
    console.log('Pour exécuter en conditions réelles :');
    console.log('  LIVE=1 npm run judge:calibration');
    console.log('='.repeat(70) + '\n');
    return;
  }

  // 2. Live execution: strictly require LIVE=1, RODIUM_API_KEY, RODIUM_MODEL
  if (process.env.LIVE !== '1') {
    console.error(
      '\n[REFUS] Exécution bloquée : la calibration du juge émet de réels appels LLM payants.',
    );
    console.error(
      'Définissez LIVE=1 pour autoriser les requêtes réseau, ou utilisez --dry-run pour prévisualiser le plan.',
    );
    console.error('Exemple : LIVE=1 npm run judge:calibration\n');
    process.exit(1);
  }

  const apiKey = process.env.RODIUM_API_KEY || process.env.RODIUMAI_API_KEY;
  if (!apiKey) {
    console.error(
      '\n[ERREUR] Variable d\'environnement RODIUM_API_KEY manquante.',
    );
    process.exit(1);
  }

  const rodiumModel = process.env.RODIUM_MODEL || process.env.RODIUMAI_MODEL;
  if (!rodiumModel) {
    console.error(
      '\n[ERREUR] Variable d\'environnement RODIUM_MODEL manquante.',
    );
    process.exit(1);
  }

  const baseUrl =
    process.env.RODIUM_BASE_URL ||
    process.env.RODIUMAI_BASE_URL ||
    'https://api.rodiumai.io/v1';

  // 3. Initialize client with cap
  const underlyingLlm = new RodiumClient({
    apiKey,
    model,
    baseUrl,
  });
  const cappedLlm = new CappedJudgeLlmClient(underlyingLlm, args.maxLlmCalls);
  const judgeEvaluator = createJudgeEvaluator({ llm: cappedLlm });

  console.log('\n' + '='.repeat(70));
  console.log('  EXÉCUTION DE LA CALIBRATION DU JUGE LLM (LIVE)');
  console.log('='.repeat(70));
  console.log(`Modèle            : ${model}`);
  console.log(`Nombre de cas     : ${JUDGE_CASES.length}`);
  console.log(`Plafond appels    : ${args.maxLlmCalls}`);
  console.log('-'.repeat(70));

  interface CaseResult {
    readonly caseItem: JudgeCase;
    readonly actual: 'ok' | 'pas_encore';
    readonly matched: boolean;
    readonly critique?: string;
  }

  const results: CaseResult[] = [];

  for (const c of JUDGE_CASES) {
    const toolCalls: ToolCallTraceEvent[] = c.toolResults.map((t) => ({
      type: 'tool_call',
      step: 1,
      agent: 'agent',
      name: t.outil,
      arguments: t.arguments ?? {},
      result: t.resultat,
      durationMs: 10,
    }));

    try {
      const verdict = await judgeEvaluator({
        userMessage: c.userMessage,
        reply: c.reply,
        trace: toolCalls,
        catalogue: INITIAL_PRODUCTS,
      });

      const actual: 'ok' | 'pas_encore' = verdict.ok ? 'ok' : 'pas_encore';
      const matched = actual === c.expected;
      const critique =
        !verdict.ok && verdict.violations[0]?.critique
          ? verdict.violations[0].critique
          : undefined;

      results.push({ caseItem: c, actual, matched, critique });

      const statusTag = matched ? '[ACCORD]' : '[DÉSACCORD]';
      console.log(
        `${statusTag.padEnd(12)} ${c.id.padEnd(35)} attendu: ${c.expected.padEnd(10)} obtenu: ${actual}`,
      );
      if (!matched && critique) {
        console.log(`             Critique du juge : ${critique}`);
      }
    } catch (err) {
      if (err instanceof MaxJudgeCallsReachedError) {
        console.error(`\n[STOP] Plafond d'appels atteint : ${err.message}`);
        break;
      }
      console.error(`\n[ERREUR] Échec sur le cas ${c.id} :`, err);
      break;
    }
  }

  // 4. Summary table
  const accords = results.filter((r) => r.matched).length;
  const agreementRate =
    results.length > 0 ? ((accords / results.length) * 100).toFixed(1) : '0.0';

  console.log('\n' + '='.repeat(70));
  console.log('  RÉCAPITULATIF DE CALIBRATION');
  console.log('='.repeat(70));
  console.log(
    'Cas'.padEnd(35) +
      'Attendu'.padEnd(14) +
      'Obtenu'.padEnd(14) +
      'Résultat',
  );
  console.log('-'.repeat(70));

  for (const r of results) {
    const resultLabel = r.matched ? 'ACCORD' : 'DÉSACCORD';
    console.log(
      r.caseItem.id.padEnd(35) +
        r.caseItem.expected.padEnd(14) +
        r.actual.padEnd(14) +
        resultLabel,
    );
  }

  console.log('-'.repeat(70));
  console.log(`Taux d'accord global    : ${accords} / ${results.length} (${agreementRate} %)`);
  console.log(`Appels LLM consommés   : ${cappedLlm.callCount} / ${args.maxLlmCalls}`);
  console.log('='.repeat(70) + '\n');
}

// Direct execution
if (
  process.argv[1] &&
  (process.argv[1].endsWith('judge-calibration.ts') ||
    process.argv[1].endsWith('judge-calibration.js'))
) {
  runCalibration().catch((err) => {
    console.error('Erreur inattendue lors de la calibration :', err);
    process.exit(1);
  });
}
