import type { Shop, OrderInput } from '../domain/shop.js';
import { isExplicitConfirmation } from '../domain/confirmation.js';
import { parseOrderArguments } from '../tools/creer-commande.js';
import type { ConversationContext } from './conversation-context.js';

export const ASYNC_CONFIRMATION_REQUIRED_MESSAGE =
  'présenter au client le récapitulatif obtenu avec calculer_total puis attendre sa confirmation explicite dans un message suivant avant de créer la commande';

export type AsyncGuardCheckResult =
  | { readonly canExecute: true; readonly params: OrderInput }
  | { readonly canExecute: false; readonly directResult: Record<string, unknown> };

/**
 * Checks whether an invocation of creer_commande in "async" mode satisfies the 4 mandatory preconditions:
 * (1) lastQuote exists
 * (2) lastQuote.turnId < current turnId
 * (3) isExplicitConfirmation(lastClientMessage) is true
 * (4) canonical delivery zone and multiset (ref, quantity) match lastQuote
 */
export function checkAsyncOrderGuard(
  args: unknown,
  conversation: ConversationContext | undefined,
  shop: Shop,
): AsyncGuardCheckResult {
  const parsed = parseOrderArguments(args);
  if (!parsed.success) {
    return {
      canExecute: false,
      directResult: parsed.error,
    };
  }

  // Precondition 1: lastQuote exists
  if (!conversation || !conversation.lastQuote) {
    return {
      canExecute: false,
      directResult: {
        erreur: 'confirmation requise',
        conseil: ASYNC_CONFIRMATION_REQUIRED_MESSAGE,
        detail: 'aucun devis préalable (calculer_total requis)',
      },
    };
  }

  const quote = conversation.lastQuote;
  const currentTurnId = conversation.turnId;

  // Precondition 2: lastQuote.turnId < currentTurnId
  if (quote.turnId >= currentTurnId) {
    return {
      canExecute: false,
      directResult: {
        erreur: 'confirmation requise',
        conseil: ASYNC_CONFIRMATION_REQUIRED_MESSAGE,
        detail:
          'le devis et la confirmation doivent avoir lieu dans des tours distincts (devis généré au même tour)',
      },
    };
  }

  // Precondition 3: isExplicitConfirmation(lastClientMessage)
  const clientMessage = conversation.lastClientMessage ?? '';
  if (!isExplicitConfirmation(clientMessage)) {
    return {
      canExecute: false,
      directResult: {
        erreur: 'confirmation requise',
        conseil: ASYNC_CONFIRMATION_REQUIRED_MESSAGE,
        detail: 'accord explicite du client manquant ou non reconnu',
      },
    };
  }

  // Precondition 4: canonical zone and multiset (ref, quantity) match
  const canonicalQuoteZone = shop.getDeliveryZone(quote.zone)?.zone;
  const canonicalArgZone = shop.getDeliveryZone(parsed.params.zone)?.zone;

  if (
    !canonicalQuoteZone ||
    !canonicalArgZone ||
    canonicalQuoteZone !== canonicalArgZone
  ) {
    return {
      canExecute: false,
      directResult: {
        erreur: 'confirmation requise',
        conseil: ASYNC_CONFIRMATION_REQUIRED_MESSAGE,
        detail: 'la zone de livraison ne correspond pas au dernier devis calculé',
      },
    };
  }

  const quoteMultiset = new Map<string, number>();
  for (const item of quote.lignes) {
    const key = item.ref.trim().toUpperCase();
    quoteMultiset.set(key, (quoteMultiset.get(key) ?? 0) + item.quantite);
  }

  const argMultiset = new Map<string, number>();
  for (const item of parsed.params.articles) {
    const key = item.ref.trim().toUpperCase();
    argMultiset.set(key, (argMultiset.get(key) ?? 0) + item.quantite);
  }

  let multisetsMatch = quoteMultiset.size === argMultiset.size;
  if (multisetsMatch) {
    for (const [key, qty] of quoteMultiset.entries()) {
      if (argMultiset.get(key) !== qty) {
        multisetsMatch = false;
        break;
      }
    }
  }

  if (!multisetsMatch) {
    return {
      canExecute: false,
      directResult: {
        erreur: 'confirmation requise',
        conseil: ASYNC_CONFIRMATION_REQUIRED_MESSAGE,
        detail: 'les articles ou quantités ne correspondent pas au dernier devis calculé',
      },
    };
  }

  return {
    canExecute: true,
    params: parsed.params,
  };
}
