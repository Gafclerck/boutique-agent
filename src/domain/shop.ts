import {
  INITIAL_PRODUCTS,
  INITIAL_ZONES,
  CANONICAL_ZONE_NAMES,
  normalizeText,
  extractWords,
  filterSignificantWords,
  wordMatches,
  type Product,
  type Zone,
} from './catalogue.js';
import { calculateTotal, type PricedItem } from './pricing.js';
import {
  type RecordedOrder,
  type RecordedOrderLine,
  type ShopState,
  type ShopStore,
} from '../ports/shop-store.js';
import { InMemoryStore } from '../adapters/store/in-memory-store.js';
import {
  type OrderDecisionResult,
  type OrderStatus,
  extractOrderNumber,
  transitionToConfirmed,
  transitionToRefused,
  transitionToCancelled,
} from './order-lifecycle.js';

export class InvalidKeywordError extends Error {
  constructor(message = 'mot-clé invalide') {
    super(message);
    this.name = 'InvalidKeywordError';
  }
}

export type OrderItem = RecordedOrderLine;
export type Order = RecordedOrder;

export interface StockCheckResult {
  readonly ref: string;
  readonly nom: string;
  readonly categorie: string;
  readonly stock: number;
  readonly disponible: boolean;
}

export interface OrderInputItem {
  readonly ref: string;
  readonly quantite: number;
}

export interface OrderInput {
  readonly clientNom?: string;
  readonly client_nom?: string;
  readonly zone: string;
  readonly articles: readonly OrderInputItem[];
}

export interface SubmitOrderInput {
  readonly chatId: string;
  readonly clientNom?: string;
  readonly client_nom?: string;
  readonly zone: string;
  readonly articles: readonly OrderInputItem[];
}

export interface OrderPreview {
  readonly client_nom: string;
  readonly zone: string;
  readonly articles: readonly OrderItem[];
  readonly frais_livraison_fcfa: number;
  readonly total_fcfa: number;
}

export type OrderFailureReason =
  | {
      readonly success: false;
      readonly reason: 'UNSERVICED_ZONE';
      readonly message: string;
      readonly zones_desservies: readonly string[];
    }
  | {
      readonly success: false;
      readonly reason: 'UNKNOWN_REFERENCE';
      readonly message: string;
      readonly ref: string;
    }
  | {
      readonly success: false;
      readonly reason: 'INSUFFICIENT_STOCK';
      readonly message: string;
      readonly stock_disponible: number;
    }
  | {
      readonly success: false;
      readonly reason: 'INVALID_INPUT';
      readonly message: string;
    };

export type OrderPreviewResult =
  | { readonly success: true; readonly preview: OrderPreview }
  | OrderFailureReason;

export type OrderCreationResult =
  | { readonly success: true; readonly order: RecordedOrder }
  | OrderFailureReason;

export type SubmitOrderResult =
  | {
      readonly success: true;
      readonly numero: number;
      readonly cancelledNumbers: readonly number[];
      readonly order: RecordedOrder;
    }
  | OrderFailureReason;

export { type OrderDecisionResult, type OrderStatus };

export class Shop {
  private readonly products: Map<string, Product>;
  private readonly store: ShopStore;

  constructor(
    store: ShopStore = new InMemoryStore(),
    initialProducts: readonly Product[] = INITIAL_PRODUCTS,
  ) {
    this.store = store;
    this.products = new Map(
      initialProducts.map((p) => [p.ref.toUpperCase(), { ...p }]),
    );
  }

  public getStore(): ShopStore {
    return this.store;
  }

  /**
   * Search catalogue products by keyword (multi-word, stop-words ignored, plural tolerated, order indifferent).
   * Catalogue details (names, categories, prices) are static.
   */
  public searchProducts(keyword: string): Product[] {
    const significantWords = filterSignificantWords(keyword);
    if (significantWords.length === 0) {
      throw new InvalidKeywordError('mot-clé invalide');
    }

    const matches: Product[] = [];

    for (const product of this.products.values()) {
      const productWords = [
        ...extractWords(product.nom),
        ...extractWords(product.categorie),
      ];

      const allWordsMatch = significantWords.every((word) =>
        wordMatches(word, productWords),
      );

      if (allWordsMatch) {
        matches.push({
          ref: product.ref,
          nom: product.nom,
          categorie: product.categorie,
          prix_fcfa: product.prix_fcfa,
          stock: product.stock,
        });
      }
    }

    return matches;
  }

  /**
   * Get product stock information by reference from store.
   */
  public async checkStock(ref: string): Promise<StockCheckResult | null> {
    const product = this.products.get(ref.trim().toUpperCase());
    if (!product) return null;

    const state = await this.store.readState();
    const currentStock = state.stock[product.ref] ?? 0;

    return {
      ref: product.ref,
      nom: product.nom,
      categorie: product.categorie,
      stock: currentStock,
      disponible: currentStock > 0,
    };
  }

  /**
   * Get delivery zone details (case and accent insensitive).
   */
  public getDeliveryZone(zoneInput: string): Zone | null {
    const normalizedInput = normalizeText(zoneInput);
    if (!normalizedInput) return null;

    for (const zone of INITIAL_ZONES) {
      if (normalizeText(zone.zone) === normalizedInput) {
        return zone;
      }
    }

    return null;
  }

  /**
   * Common validation logic against a specific ShopState snapshot.
   * Validates references, zone, and stock availability without mutating anything.
   */
  public validateOrderAgainstState(
    params: OrderInput,
    state: ShopState,
  ): OrderPreviewResult {
    const rawNom = params.clientNom ?? params.client_nom;
    const trimmedNom = rawNom?.trim();
    if (!trimmedNom) {
      return {
        success: false,
        reason: 'INVALID_INPUT',
        message: 'nom du client manquant',
      };
    }

    const matchedZone = this.getDeliveryZone(params.zone);
    if (!matchedZone) {
      return {
        success: false,
        reason: 'UNSERVICED_ZONE',
        message: 'zone non desservie',
        zones_desservies: CANONICAL_ZONE_NAMES,
      };
    }

    if (!Array.isArray(params.articles) || params.articles.length === 0) {
      return {
        success: false,
        reason: 'INVALID_INPUT',
        message: 'la commande doit contenir au moins un article',
      };
    }

    const orderItems: OrderItem[] = [];
    const pricedItems: PricedItem[] = [];

    // Temporary tracking of quantity per reference in the current order (to handle repeated refs)
    const demandedPerRef = new Map<string, number>();

    for (const item of params.articles) {
      if (
        !item ||
        typeof item.ref !== 'string' ||
        typeof item.quantite !== 'number' ||
        !Number.isInteger(item.quantite) ||
        item.quantite < 1
      ) {
        return {
          success: false,
          reason: 'INVALID_INPUT',
          message:
            'article invalide (référence requise et quantité entière >= 1)',
        };
      }

      const upperRef = item.ref.trim().toUpperCase();
      const product = this.products.get(upperRef);
      if (!product) {
        return {
          success: false,
          reason: 'UNKNOWN_REFERENCE',
          message: 'référence inconnue',
          ref: item.ref,
        };
      }

      const previousDemanded = demandedPerRef.get(upperRef) ?? 0;
      const totalDemanded = previousDemanded + item.quantite;
      const currentAvailable = state.stock[upperRef] ?? 0;

      if (currentAvailable < totalDemanded) {
        return {
          success: false,
          reason: 'INSUFFICIENT_STOCK',
          message: `stock insuffisant pour ${product.nom}`,
          stock_disponible: currentAvailable,
        };
      }

      demandedPerRef.set(upperRef, totalDemanded);

      const sousTotal = product.prix_fcfa * item.quantite;
      orderItems.push({
        ref: product.ref,
        nom: product.nom,
        quantite: item.quantite,
        prix_unitaire_fcfa: product.prix_fcfa,
        sous_total_fcfa: sousTotal,
      });

      pricedItems.push({
        prix_unitaire_fcfa: product.prix_fcfa,
        quantite: item.quantite,
      });
    }

    const totalFcfa = calculateTotal(pricedItems, matchedZone.frais_fcfa);

    return {
      success: true,
      preview: {
        client_nom: trimmedNom,
        zone: matchedZone.zone,
        articles: orderItems,
        frais_livraison_fcfa: matchedZone.frais_fcfa,
        total_fcfa: totalFcfa,
      },
    };
  }

  /**
   * Preview an order: validates references, zone, stock and calculates total WITHOUT mutating state.
   */
  public async previewOrder(params: OrderInput): Promise<OrderPreviewResult> {
    const state = await this.store.readState();
    return this.validateOrderAgainstState(params, state);
  }

  /**
   * Place an order (console mode): validates and atomically decrements stock and registers order in store.transact.
   */
  public async placeOrder(params: OrderInput): Promise<OrderCreationResult> {
    return this.store.transact((state) => {
      const validation = this.validateOrderAgainstState(params, state);
      if (!validation.success) {
        return validation;
      }

      const preview = validation.preview;

      // Decrement stock atomically
      for (const item of preview.articles) {
        state.stock[item.ref] = (state.stock[item.ref] ?? 0) - item.quantite;
      }

      const nextNum = state.prochain_numero ?? 1;
      const numeroCommande = `CMD-${nextNum}`;
      state.prochain_numero = nextNum + 1;

      const order: RecordedOrder = {
        numero: nextNum,
        numero_commande: numeroCommande,
        client_nom: preview.client_nom,
        zone: preview.zone,
        articles: preview.articles,
        lignes: preview.articles,
        frais_livraison_fcfa: preview.frais_livraison_fcfa,
        frais: preview.frais_livraison_fcfa,
        total_fcfa: preview.total_fcfa,
        total: preview.total_fcfa,
        statut: 'confirmee',
        date: new Date().toISOString(),
      };

      state.commandes.push(order);
      return { success: true, order };
    });
  }

  /**
   * Submit an order for approval (async mode): validates without decrementing stock.
   * If there is an existing pending order for the same chatId, it is cancelled in the same transaction.
   */
  public async submitOrderForApproval(
    params: SubmitOrderInput,
  ): Promise<SubmitOrderResult> {
    return this.store.transact((state) => {
      const validation = this.validateOrderAgainstState(params, state);
      if (!validation.success) {
        return validation;
      }

      const preview = validation.preview;

      // Cancel any existing pending order for this chatId
      const cancelledNumbers: number[] = [];
      for (let i = 0; i < state.commandes.length; i++) {
        const cmd = state.commandes[i];
        if (!cmd) continue;
        if (cmd.chatId === params.chatId && cmd.statut === 'en_attente_afi') {
          const cmdNum = extractOrderNumber(cmd);
          cancelledNumbers.push(cmdNum);
          const transition = transitionToCancelled(cmd, {
            raison: 'remplacée par une nouvelle commande',
            decidedBy: 'system',
          });
          if (transition.success) {
            state.commandes[i] = transition.order;
          }
        }
      }

      const nextNum = state.prochain_numero ?? 1;
      const numeroCommande = `CMD-${nextNum}`;
      state.prochain_numero = nextNum + 1;

      const order: RecordedOrder = {
        numero: nextNum,
        numero_commande: numeroCommande,
        chatId: params.chatId,
        client_nom: preview.client_nom,
        zone: preview.zone,
        articles: preview.articles,
        lignes: preview.articles,
        frais_livraison_fcfa: preview.frais_livraison_fcfa,
        frais: preview.frais_livraison_fcfa,
        total_fcfa: preview.total_fcfa,
        total: preview.total_fcfa,
        statut: 'en_attente_afi',
        date: new Date().toISOString(),
      };

      state.commandes.push(order);

      return {
        success: true,
        numero: nextNum,
        cancelledNumbers,
        order,
      };
    });
  }

  /**
   * Approve an order: revalidates stock and decrements atomically.
   * If insufficient stock at approval, cancels order without decrement.
   */
  public async approveOrder(
    numero: number | string,
  ): Promise<OrderDecisionResult> {
    return this.store.transact((state) => {
      const targetNum =
        typeof numero === 'number'
          ? numero
          : parseInt(String(numero).replace(/\D/g, ''), 10);

      const idx = state.commandes.findIndex((cmd) => {
        if (cmd.numero === targetNum) return true;
        if (
          cmd.numero_commande === String(numero) ||
          cmd.numero_commande === `CMD-${targetNum}`
        ) {
          return true;
        }
        return extractOrderNumber(cmd) === targetNum;
      });

      if (idx === -1) {
        return { status: 'introuvable' };
      }

      const order = state.commandes[idx];
      if (!order) {
        return { status: 'introuvable' };
      }
      if (order.statut !== 'en_attente_afi') {
        return { status: 'deja_traitee', current: order };
      }

      // Group demanded quantities per ref
      const neededPerRef = new Map<string, { demanded: number; nom: string }>();
      for (const item of order.articles) {
        const prev = neededPerRef.get(item.ref) ?? {
          demanded: 0,
          nom: item.nom,
        };
        neededPerRef.set(item.ref, {
          demanded: prev.demanded + item.quantite,
          nom: item.nom,
        });
      }

      for (const [ref, { demanded, nom }] of neededPerRef) {
        const available = state.stock[ref] ?? 0;
        if (available < demanded) {
          const raison = `stock insuffisant pour ${nom}`;
          const cancelled = transitionToCancelled(order, {
            raison,
            decidedBy: 'system',
          });
          if (cancelled.success) {
            state.commandes[idx] = cancelled.order;
          }
          return { status: 'annulee_stock', raison };
        }
      }

      // Decrement stock
      for (const [ref, { demanded }] of neededPerRef) {
        state.stock[ref] = (state.stock[ref] ?? 0) - demanded;
      }

      const transition = transitionToConfirmed(order, { decidedBy: 'afi' });
      if (!transition.success) {
        return { status: 'deja_traitee', current: transition.current };
      }

      state.commandes[idx] = transition.order;
      return { status: 'ok', order: transition.order };
    });
  }

  /**
   * Reject an order with optional reason.
   */
  public async rejectOrder(
    numero: number | string,
    raison?: string,
  ): Promise<OrderDecisionResult> {
    return this.store.transact((state) => {
      const targetNum =
        typeof numero === 'number'
          ? numero
          : parseInt(String(numero).replace(/\D/g, ''), 10);

      const idx = state.commandes.findIndex((cmd) => {
        if (cmd.numero === targetNum) return true;
        if (
          cmd.numero_commande === String(numero) ||
          cmd.numero_commande === `CMD-${targetNum}`
        ) {
          return true;
        }
        return extractOrderNumber(cmd) === targetNum;
      });

      if (idx === -1) {
        return { status: 'introuvable' };
      }

      const order = state.commandes[idx];
      if (!order) {
        return { status: 'introuvable' };
      }
      if (order.statut !== 'en_attente_afi') {
        return { status: 'deja_traitee', current: order };
      }

      const transition = transitionToRefused(order, {
        raison,
        decidedBy: 'afi',
      });
      if (!transition.success) {
        return { status: 'deja_traitee', current: transition.current };
      }

      state.commandes[idx] = transition.order;
      return { status: 'ok', order: transition.order };
    });
  }

  /**
   * Cancel an order with required reason.
   */
  public async cancelOrder(
    numero: number | string,
    raison: string,
  ): Promise<OrderDecisionResult> {
    return this.store.transact((state) => {
      const targetNum =
        typeof numero === 'number'
          ? numero
          : parseInt(String(numero).replace(/\D/g, ''), 10);

      const idx = state.commandes.findIndex((cmd) => {
        if (cmd.numero === targetNum) return true;
        if (
          cmd.numero_commande === String(numero) ||
          cmd.numero_commande === `CMD-${targetNum}`
        ) {
          return true;
        }
        return extractOrderNumber(cmd) === targetNum;
      });

      if (idx === -1) {
        return { status: 'introuvable' };
      }

      const order = state.commandes[idx];
      if (!order) {
        return { status: 'introuvable' };
      }
      if (order.statut !== 'en_attente_afi') {
        return { status: 'deja_traitee', current: order };
      }

      const transition = transitionToCancelled(order, {
        raison,
        decidedBy: 'system',
      });
      if (!transition.success) {
        return { status: 'deja_traitee', current: transition.current };
      }

      state.commandes[idx] = transition.order;
      return { status: 'ok', order: transition.order };
    });
  }

  /**
   * Get all confirmed orders from the store.
   */
  public async getOrders(): Promise<readonly RecordedOrder[]> {
    const state = await this.store.readState();
    return state.commandes;
  }
}
