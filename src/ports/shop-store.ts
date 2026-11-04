import { INITIAL_PRODUCTS, type Product } from '../domain/catalogue.js';
import type { OrderStatus } from '../domain/order-lifecycle.js';

export interface RecordedOrderLine {
  readonly ref: string;
  readonly nom: string;
  readonly quantite: number;
  readonly prix_unitaire_fcfa: number;
  readonly sous_total_fcfa: number;
}

export interface RecordedOrder {
  readonly numero?: number;
  readonly numero_commande: string;
  readonly chatId?: string;
  readonly client_nom: string;
  readonly zone: string;
  readonly articles: readonly RecordedOrderLine[];
  readonly lignes: readonly RecordedOrderLine[];
  readonly frais_livraison_fcfa: number;
  readonly frais: number;
  readonly total_fcfa: number;
  readonly total: number;
  readonly statut: OrderStatus;
  readonly date: string;
  readonly decidedAt?: string;
  readonly decidedBy?: string;
  readonly raison?: string;
}

export interface ShopState {
  stock: Record<string, number>;
  commandes: RecordedOrder[];
  prochain_numero: number;
}

export interface ShopStore {
  readState(): Promise<ShopState>;
  transact<T>(mutator: (state: ShopState) => Promise<T> | T): Promise<T>;
}

export function createInitialShopState(
  products: readonly Product[] = INITIAL_PRODUCTS,
): ShopState {
  const stock: Record<string, number> = {};
  for (const product of products) {
    stock[product.ref.toUpperCase()] = product.stock;
  }
  return {
    stock,
    commandes: [],
    prochain_numero: 1,
  };
}
