import {
  createInitialShopState,
  type ShopState,
  type ShopStore,
} from '../../ports/shop-store.js';

export class InMemoryStore implements ShopStore {
  private state: ShopState;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(initialState?: ShopState) {
    this.state = initialState
      ? structuredClone(initialState)
      : createInitialShopState();
  }

  public async readState(): Promise<ShopState> {
    return structuredClone(this.state);
  }

  public async transact<T>(
    mutator: (state: ShopState) => Promise<T> | T,
  ): Promise<T> {
    const runTransaction = async (): Promise<T> => {
      const workingCopy = structuredClone(this.state);
      const result = await mutator(workingCopy);
      this.state = workingCopy;
      return result;
    };

    const nextPromise = this.queue.then(runTransaction, runTransaction);
    this.queue = nextPromise.catch(() => {});
    return nextPromise;
  }
}
