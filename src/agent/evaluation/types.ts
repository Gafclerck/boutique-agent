import type { Product } from '../../domain/catalogue.js';
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
}
