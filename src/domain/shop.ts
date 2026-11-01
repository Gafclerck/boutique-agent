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

export class InvalidKeywordError extends Error {
  constructor(message = 'mot-clé invalide') {
    super(message);
    this.name = 'InvalidKeywordError';
  }
}

export interface OrderItem {
  readonly ref: string;
  readonly nom: string;
  readonly quantite: number;
  readonly prix_unitaire_fcfa: number;
  readonly sous_total_fcfa: number;
}

export interface Order {
  readonly numero_commande: string;
  readonly client_nom: string;
  readonly zone: string;
  readonly articles: readonly OrderItem[];
  readonly frais_livraison_fcfa: number;
  readonly total_fcfa: number;
}

export interface StockCheckResult {
  readonly ref: string;
  readonly nom: string;
  readonly categorie: string;
  readonly stock: number;
  readonly disponible: boolean;
}

export type OrderCreationResult =
  | { readonly success: true; readonly order: Order }
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

/**
 * PALIER 1 DESIGN NOTE:
 * At Palier 1, no human validation workflow exists (Afi validation will be introduced in Palier 2).
 * The order is directly registered and confirmed in memory as soon as the client explicitly agrees.
 */
export class Shop {
  private products: Map<
    string,
    { ref: string; nom: string; categorie: string; prix_fcfa: number; stock: number }
  >;
  private orders: Order[] = [];
  private orderCounter = 1;

  constructor(initialProducts: readonly Product[] = INITIAL_PRODUCTS) {
    this.products = new Map(
      initialProducts.map((p) => [p.ref.toUpperCase(), { ...p }]),
    );
  }

  /**
   * Search catalogue products by keyword (multi-word, stop-words ignored, plural tolerated, order indifferent).
   * A product matches if EVERY remaining word matches a word of the product's name OR category.
   * Throws InvalidKeywordError if keyword is empty or composed only of stop-words.
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
   * Get product stock information by reference.
   */
  public checkStock(ref: string): StockCheckResult | null {
    const product = this.products.get(ref.trim().toUpperCase());
    if (!product) return null;

    return {
      ref: product.ref,
      nom: product.nom,
      categorie: product.categorie,
      stock: product.stock,
      disponible: product.stock > 0,
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
   * Create an order with atomic stock decrement.
   * If any item is invalid or out of stock, nothing is decremented.
   */
  public createOrder(params: {
    clientNom: string;
    zone: string;
    articles: ReadonlyArray<{ ref: string; quantite: number }>;
  }): OrderCreationResult {
    const trimmedNom = params.clientNom?.trim();
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

    // Phase 1: Verification (atomicity check)
    const verifiedItems: Array<{
      product: { ref: string; nom: string; categorie: string; prix_fcfa: number; stock: number };
      quantite: number;
    }> = [];

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
          message: 'article invalide (référence requise et quantité entière >= 1)',
        };
      }

      const product = this.products.get(item.ref.trim().toUpperCase());
      if (!product) {
        return {
          success: false,
          reason: 'UNKNOWN_REFERENCE',
          message: 'référence inconnue',
          ref: item.ref,
        };
      }

      if (product.stock < item.quantite) {
        return {
          success: false,
          reason: 'INSUFFICIENT_STOCK',
          message: `stock insuffisant pour ${product.nom}`,
          stock_disponible: product.stock,
        };
      }

      verifiedItems.push({ product, quantite: item.quantite });
    }

    // Phase 2: Atomic Execution (decrement stock)
    const orderItems: OrderItem[] = [];
    const pricedItems: PricedItem[] = [];

    for (const { product, quantite } of verifiedItems) {
      product.stock -= quantite;

      const sousTotal = product.prix_fcfa * quantite;
      orderItems.push({
        ref: product.ref,
        nom: product.nom,
        quantite,
        prix_unitaire_fcfa: product.prix_fcfa,
        sous_total_fcfa: sousTotal,
      });

      pricedItems.push({
        prix_unitaire_fcfa: product.prix_fcfa,
        quantite,
      });
    }

    const totalFcfa = calculateTotal(pricedItems, matchedZone.frais_fcfa);
    const numeroCommande = `CMD-${this.orderCounter++}`;

    const order: Order = {
      numero_commande: numeroCommande,
      client_nom: trimmedNom,
      zone: matchedZone.zone,
      articles: orderItems,
      frais_livraison_fcfa: matchedZone.frais_fcfa,
      total_fcfa: totalFcfa,
    };

    this.orders.push(order);
    return { success: true, order };
  }

  public getOrders(): readonly Order[] {
    return this.orders;
  }
}
