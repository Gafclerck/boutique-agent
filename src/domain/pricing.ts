export interface PricedItem {
  readonly prix_unitaire_fcfa: number;
  readonly quantite: number;
}

/**
 * Pure function: total = sum(unit_price * quantity) + delivery_fee
 */
export function calculateTotal(
  items: ReadonlyArray<PricedItem>,
  fraisLivraisonFcfa: number,
): number {
  const itemsTotal = items.reduce(
    (sum, item) => sum + item.prix_unitaire_fcfa * item.quantite,
    0,
  );
  return itemsTotal + fraisLivraisonFcfa;
}
