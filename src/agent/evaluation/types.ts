import type { Product } from '../../domain/catalogue.js';
import type { TokenUsage } from '../../ports/llm-client.js';
import type { TraceEvent } from '../trace.js';

export interface EvaluationInput {
  readonly userMessage: string;
  readonly reply: string;
  readonly trace: readonly TraceEvent[];
  readonly catalogue: readonly Product[];
  readonly hasPriorCatalogueLookup?: boolean;
}

export interface Violation {
  readonly rule: string;
  readonly critique: string;
}

export interface Verdict {
  readonly ok: boolean;
  readonly violations: readonly Violation[];
  readonly llmCalls?: number;
  readonly usage?: TokenUsage;
  readonly traceEvents?: readonly TraceEvent[];
}

export type Evaluator = (input: EvaluationInput) => Verdict | Promise<Verdict>;
