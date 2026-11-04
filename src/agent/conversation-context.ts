export interface QuoteSnapshotLine {
  readonly ref: string;
  readonly quantite: number;
}

export interface QuoteSnapshot {
  readonly zone: string;
  readonly lignes: readonly QuoteSnapshotLine[];
  readonly total_fcfa: number;
  readonly turnId: number;
}

export interface ConversationContext {
  readonly chatId: string;
  turnId: number;
  lastQuote?: QuoteSnapshot;
  lastClientMessage?: string;
}

export interface SubmittedOrderInfo {
  readonly numero: number;
  readonly cancelledNumbers: readonly number[];
}
