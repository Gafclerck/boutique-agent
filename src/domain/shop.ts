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
   * Place an order: validates and atomically decrements stock and registers order in store.transact.
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
   * Alias for placeOrder for backward compatibility.
   */
  public async createOrder(params: OrderInput): Promise<OrderCreationResult> {
    return this.placeOrder(params);
  }

  /**
   * Get all confirmed orders from the store.
   */
  public async getOrders(): Promise<readonly RecordedOrder[]> {
    const state = await this.store.readState();
    return state.commandes;
  }
}
