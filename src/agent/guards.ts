import type { ApprovalPort } from '../ports/approval.js';
import type { Tool } from '../tools/types.js';
import type { ApprovalTraceEvent } from './trace.js';

export const REFUSAL_OBSERVATION = {
  erreur: 'commande refusée par la boutique',
  conseil:
    "informer le client poliment que la commande n'a pas été validée ; ne pas la recréer sans nouvelle demande du client",
} as const;

export const UNAVAILABLE_VALIDATION_OBSERVATION = {
  erreur: 'validation indisponible',
  conseil:
    "informer le client que la validation de la commande est indisponible ; ne pas enregistrer la commande",
} as const;

export interface GuardEvaluationResult {
  readonly canExecute: boolean;
  readonly directResult?: Record<string, unknown>;
  readonly approvalEvent?: ApprovalTraceEvent;
}

/**
 * Checks whether an invocation of a tool requires and obtains human approval.
 * - If the tool doesn't require approval: proceeds normally.
 * - If requiresApproval:
 *   1. Calls tool.prepareApproval(args). If preparation fails (stock, zone...),
 *      returns the business error without soliciting human approval.
 *   2. If preparation succeeds:
 *      - If no ApprovalPort is provided: fails closed with "validation indisponible".
 *      - If ApprovalPort is provided: requests approval.
 *        * If refused: fails closed with "commande refusée par la boutique".
 *        * If approved: allows execution.
 */
export async function evaluateToolGuard(
  tool: Tool,
  parsedArgs: unknown,
  step: number,
  approvalPort?: ApprovalPort,
): Promise<GuardEvaluationResult> {
  if (!tool.requiresApproval) {
    return { canExecute: true };
  }

  // 1. Preparation & business validation (preview)
  if (typeof tool.prepareApproval === 'function') {
    const prep = await tool.prepareApproval(parsedArgs);
    if (!prep.valid) {
      // Preview failed: return business error directly, DO NOT solicit approval
      return {
        canExecute: false,
        directResult: prep.errorResult ?? {
          erreur: 'erreur lors de la prévisualisation de la commande',
        },
      };
    }

    // 2. Check availability of approval port (fail closed)
    if (!approvalPort) {
      const approvalEvent: ApprovalTraceEvent = {
        type: 'approval',
        step,
        tool: tool.name,
        decision: false,
        reason: 'validation indisponible (aucun port fourni)',
      };
      return {
        canExecute: false,
        directResult: UNAVAILABLE_VALIDATION_OBSERVATION,
        approvalEvent,
      };
    }

    // 3. Solicit human approval
    const request = prep.request!;
    const decision = await approvalPort.request(request);

    const approvalEvent: ApprovalTraceEvent = {
      type: 'approval',
      step,
      tool: tool.name,
      decision: decision.approved,
      reason: decision.reason,
    };

    if (!decision.approved) {
      return {
        canExecute: false,
        directResult: REFUSAL_OBSERVATION,
        approvalEvent,
      };
    }

    return {
      canExecute: true,
      approvalEvent,
    };
  }

  // If tool requires approval but has no prepareApproval method, fail closed if no port
  if (!approvalPort) {
    return {
      canExecute: false,
      directResult: UNAVAILABLE_VALIDATION_OBSERVATION,
      approvalEvent: {
        type: 'approval',
        step,
        tool: tool.name,
        decision: false,
        reason: 'validation indisponible',
      },
    };
  }

  return { canExecute: true };
}
