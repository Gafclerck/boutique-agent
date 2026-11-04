import type { RecordedOrder } from '../ports/shop-store.js';

export type OrderStatus =
  | 'en_attente_afi'
  | 'confirmee'
  | 'refusee'
  | 'annulee';

export interface TransitionSuccess {
  readonly success: true;
  readonly order: RecordedOrder;
}

export interface TransitionAlreadyDecided {
  readonly success: false;
  readonly reason: 'deja_traitee';
  readonly current: RecordedOrder;
}

export type TransitionResult = TransitionSuccess | TransitionAlreadyDecided;

export type OrderDecisionResult =
  | { readonly status: 'ok'; readonly order: RecordedOrder }
  | { readonly status: 'deja_traitee'; readonly current: RecordedOrder }
  | { readonly status: 'introuvable' }
  | { readonly status: 'annulee_stock'; readonly raison: string };

export function extractOrderNumber(
  order: Pick<RecordedOrder, 'numero' | 'numero_commande'>,
): number {
  if (typeof order.numero === 'number' && Number.isInteger(order.numero)) {
    return order.numero;
  }
  const parsed = parseInt(order.numero_commande.replace(/\D/g, ''), 10);
  return Number.isNaN(parsed) ? 0 : parsed;
}

/**
 * Checks whether an order is in a state that allows Afi or system transitions.
 * Only orders in 'en_attente_afi' can transition.
 */
export function canTransitionOrder(order: RecordedOrder): boolean {
  return order.statut === 'en_attente_afi';
}

/**
 * Pure transition of an order from 'en_attente_afi' to 'confirmee'.
 * Immutable snapshot: all order lines, client, zone, amounts are preserved.
 */
export function transitionToConfirmed(
  order: RecordedOrder,
  params?: {
    decidedAt?: string;
    decidedBy?: string;
  },
): TransitionResult {
  if (!canTransitionOrder(order)) {
    return { success: false, reason: 'deja_traitee', current: order };
  }

  const updated: RecordedOrder = {
    ...order,
    statut: 'confirmee',
    decidedAt: params?.decidedAt ?? new Date().toISOString(),
    decidedBy: params?.decidedBy ?? 'afi',
  };

  return { success: true, order: updated };
}

/**
 * Pure transition of an order from 'en_attente_afi' to 'refusee'.
 */
export function transitionToRefused(
  order: RecordedOrder,
  params?: {
    raison?: string;
    decidedAt?: string;
    decidedBy?: string;
  },
): TransitionResult {
  if (!canTransitionOrder(order)) {
    return { success: false, reason: 'deja_traitee', current: order };
  }

  const updated: RecordedOrder = {
    ...order,
    statut: 'refusee',
    raison: params?.raison,
    decidedAt: params?.decidedAt ?? new Date().toISOString(),
    decidedBy: params?.decidedBy ?? 'afi',
  };

  return { success: true, order: updated };
}

/**
 * Pure transition of an order from 'en_attente_afi' to 'annulee'.
 */
export function transitionToCancelled(
  order: RecordedOrder,
  params: {
    raison: string;
    decidedAt?: string;
    decidedBy?: string;
  },
): TransitionResult {
  if (!canTransitionOrder(order)) {
    return { success: false, reason: 'deja_traitee', current: order };
  }

  const updated: RecordedOrder = {
    ...order,
    statut: 'annulee',
    raison: params.raison,
    decidedAt: params.decidedAt ?? new Date().toISOString(),
    decidedBy: params.decidedBy ?? 'system',
  };

  return { success: true, order: updated };
}
