import { RodiumClient } from '../adapters/llm/rodium-client.js';
import type { Product } from '../domain/catalogue.js';
import { Shop } from '../domain/shop.js';
import type { ApprovalPort } from '../ports/approval.js';
import type { ChatMessage, LlmClient } from '../ports/llm-client.js';
import { createDefaultRegistry, ToolRegistry } from '../tools/registry.js';
import { createCallBudget, withCallBudget } from './budget.js';
import {
  collectHistoryGrounding,
  composeEvaluators,
  createJudgeEvaluator,
  evaluateReply,
  type Evaluator,
} from './evaluation/index.js';
import { SYSTEM_INSTRUCTIONS } from './instructions.js';
import { type AgentRunResult, runAgent } from './loop.js';
import { buildTeam } from './team/build-team.js';

export type RunnerMode = 'single' | 'team';

export interface TurnRunnerParams {
  readonly userMessage: string;
  readonly history?: readonly ChatMessage[];
  readonly priorToolNames?: ReadonlySet<string>;
}

export type TurnRunner = (params: TurnRunnerParams) => Promise<AgentRunResult>;

export interface CreateRunnerDeps {
  readonly mode?: RunnerMode;
  readonly llm: LlmClient;
  readonly shop?: Shop | (() => Shop);
  readonly approval?: ApprovalPort;
  readonly fetchFn?: typeof fetch;
  readonly tools?: ToolRegistry;
  readonly evaluate?: Evaluator | null;
  readonly judgeLlm?: LlmClient;
  readonly judgeClientFactory?: () => LlmClient;
  readonly maxTotalLlmCalls?: number;
  readonly maxEvaluationRetries?: number;
  readonly maxSteps?: number;
  readonly maxTokens?: number;
  readonly catalogue?: readonly Product[];
  readonly maxStepsSpecialist?: number;
  readonly maxTokensSpecialist?: number;
}

export function resolveRunnerMode(
  argv?: readonly string[],
  envMode?: string,
): RunnerMode {
  if (argv) {
    for (let i = 0; i < argv.length; i++) {
      const arg = argv[i];
      if (arg === '--mode' && i + 1 < argv.length) {
        const next = argv[i + 1]?.toLowerCase();
        if (next === 'team' || next === 'single') return next;
      }
      if (arg?.startsWith('--mode=')) {
        const val = arg.slice('--mode='.length).toLowerCase();
        if (val === 'team' || val === 'single') return val;
      }
    }
  }
  const fromEnv = (envMode ?? process.env.MODE ?? '').toLowerCase();
  if (fromEnv === 'team' || fromEnv === 'single') {
    return fromEnv;
  }
  return 'single';
}

export function createRunner(deps: CreateRunnerDeps): TurnRunner {
  const mode: RunnerMode = deps.mode ?? 'single';
  const maxCalls =
    deps.maxTotalLlmCalls ??
    (process.env.MAX_TOTAL_LLM_CALLS
      ? Math.max(1, Number.parseInt(process.env.MAX_TOTAL_LLM_CALLS, 10) || 20)
      : 20);

  return async function turnRunner(
    params: TurnRunnerParams,
  ): Promise<AgentRunResult> {
    const turnBudget = createCallBudget(maxCalls);
    const cappedLlm = withCallBudget(deps.llm, turnBudget);

    let evaluate: Evaluator | undefined;
    if (deps.evaluate === null || process.env.EVALUATION === 'off') {
      evaluate = undefined;
    } else if (deps.evaluate !== undefined) {
      evaluate = deps.evaluate;
    } else if (process.env.JUDGE === 'on') {
      const judgeModel =
        process.env.JUDGE_MODEL || process.env.RODIUM_MODEL;
      const rawJudge =
        deps.judgeLlm ??
        (deps.judgeClientFactory
          ? deps.judgeClientFactory()
          : new RodiumClient({ model: judgeModel }));
      const cappedJudge = withCallBudget(rawJudge, turnBudget);
      const judge = createJudgeEvaluator({ llm: cappedJudge });
      evaluate = composeEvaluators(evaluateReply, judge);
    } else {
      evaluate = evaluateReply;
    }

    const currentShop =
      typeof deps.shop === 'function'
        ? deps.shop()
        : (deps.shop ?? new Shop());

    let instructions: string;
    let tools: ToolRegistry;
    let role: string;

    if (mode === 'team') {
      role = 'gerant';
      const team = buildTeam({
        llm: cappedLlm,
        shop: currentShop,
        approval: deps.approval,
        fetchFn: deps.fetchFn,
        maxStepsSpecialist: deps.maxStepsSpecialist,
        maxTokensSpecialist: deps.maxTokensSpecialist,
      });
      instructions = team.instructions;
      tools = team.tools;
    } else {
      role = 'agent';
      instructions = SYSTEM_INSTRUCTIONS;
      tools = deps.tools ?? createDefaultRegistry(currentShop, deps.fetchFn);
    }

    const historyGrounding = collectHistoryGrounding(params.history);

    return runAgent({
      llm: cappedLlm,
      tools,
      instructions,
      userMessage: params.userMessage,
      history: params.history,
      priorToolNames: params.priorToolNames,
      approval: deps.approval,
      evaluate,
      historyGrounding,
      maxEvaluationRetries: deps.maxEvaluationRetries ?? 2,
      role,
      catalogue: deps.catalogue,
      maxSteps: deps.maxSteps,
      maxTokens: deps.maxTokens,
    });
  };
}
