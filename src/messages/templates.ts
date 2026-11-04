import type { RecordedOrder } from '../ports/shop-store.js';
import { extractOrderNumber } from '../domain/order-lifecycle.js';

/**
 * Formats monetary amounts using standard ASCII space (\\u0020) for thousands.
 */
export function formatAmount(amount: number): string {
  return amount.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}

function normalizeOrderNumber(numero: number | string): number {
  if (typeof numero === 'number' && Number.isInteger(numero)) {
    return numero;
  }
  const parsed = parseInt(String(numero).replace(/\D/g, ''), 10);
  return Number.isNaN(parsed) ? 0 : parsed;
}

/**
 * afiRecap(order)
 * Example: "Commande #12 : 2 x Robe en wax, Calavi, 46 000 FCFA. Client : Afi (22997000000). Répondez OUI 12 ou NON 12"
 */
export function afiRecap(order: RecordedOrder): string {
  const num = extractOrderNumber(order);
  const articlesStr = order.articles
    .map((a) => `${a.quantite} x ${a.nom}`)
    .join(', ');
  const totalStr = `${formatAmount(order.total_fcfa)} FCFA`;
  const cleanPhone = (order.chatId ?? '').replace(/@c\.us$/, '');
  const clientStr = cleanPhone
    ? `${order.client_nom} (${cleanPhone})`
    : order.client_nom;

  return `Commande #${num} : ${articlesStr}, ${order.zone}, ${totalStr}. Client : ${clientStr}. Répondez OUI ${num} ou NON ${num}`;
}

/**
 * clientOrderConfirmed(order)
 * Notification to the client that Afi validated the order.
 */
export function clientOrderConfirmed(order: RecordedOrder): string {
  const num = extractOrderNumber(order);
  return `Votre commande #${num} est confirmée par la boutique. Elle vous sera livrée à ${order.zone}.`;
}

/**
 * clientOrderRefused(order)
 * Notification to the client that Afi refused the order.
 */
export function clientOrderRefused(order: RecordedOrder): string {
  const num = extractOrderNumber(order);
  const motif = order.raison ? ` Raison : ${order.raison}.` : '';
  return `Votre commande #${num} n'a pas été validée par la boutique.${motif} N'hésitez pas à nous recontacter pour toute autre demande.`;
}

/**
 * clientOrderCancelledStock(order)
 * Notification to the client that order was cancelled due to stock shortage at approval time.
 */
export function clientOrderCancelledStock(order: RecordedOrder): string {
  const num = extractOrderNumber(order);
  const precision = order.raison ? ` (${order.raison})` : '';
  return `Votre commande #${num} a dû être annulée en raison d'une rupture de stock${precision}. Nous vous prions de nous en excuser.`;
}

/**
 * clientOrderReplaced(numero)
 * Notification to the client that an earlier pending order was superseded by a new one.
 */
export function clientOrderReplaced(numero: number | string): string {
  const num = normalizeOrderNumber(numero);
  return `Votre commande #${num} en attente a été annulée et remplacée par votre nouvelle commande.`;
}

/**
 * afiAck(order, decision)
 * Acknowledgement sent to Afi after processing her OUI/NON command.
 */
export function afiAck(order: RecordedOrder, decision: 'oui' | 'non'): string {
  const num = extractOrderNumber(order);
  if (decision === 'oui') {
    return `Commande #${num} validée avec succès.`;
  }
  return `Commande #${num} refusée.`;
}

/**
 * afiAlreadyDecided(numero, statut)
 * Informs Afi that the order has already been decided.
 */
export function afiAlreadyDecided(
  numero: number | string,
  statut: string,
): string {
  const num = normalizeOrderNumber(numero);
  return `La commande #${num} a déjà été traitée (statut : ${statut}).`;
}

/**
 * afiUnknownOrder(numero)
 * Informs Afi that no order with this number was found.
 */
export function afiUnknownOrder(numero: number | string): string {
  const num = normalizeOrderNumber(numero);
  return `La commande #${num} est introuvable.`;
}

/**
 * afiHelp()
 * Help message for Afi explaining the decision syntax.
 */
export function afiHelp(): string {
  return 'Pour traiter une commande, répondez par OUI <numéro> ou NON <numéro> (ex : OUI 12).';
}

/**
 * nonAfiCommandRefused()
 * Informs unauthorized senders that only Afi can approve or refuse orders.
 */
export function nonAfiCommandRefused(): string {
  return 'Action non autorisée. Seule Afi peut valider ou refuser les commandes de la boutique.';
}
