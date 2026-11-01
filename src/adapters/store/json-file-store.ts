import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  createInitialShopState,
  type ShopState,
  type ShopStore,
} from '../../ports/shop-store.js';

export class JsonFileStore implements ShopStore {
  public readonly filePath: string;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(filePath?: string) {
    this.filePath =
      filePath ??
      process.env.SHOP_DATA_FILE ??
      path.resolve(process.cwd(), 'data/shop.json');
  }

  private validateShopState(data: unknown): ShopState {
    if (
      !data ||
      typeof data !== 'object' ||
      typeof (data as { stock?: unknown }).stock !== 'object' ||
      (data as { stock?: unknown }).stock === null ||
      !Array.isArray((data as { commandes?: unknown }).commandes) ||
      typeof (data as { prochain_numero?: unknown }).prochain_numero !== 'number'
    ) {
      throw new Error(
        `Fichier de données corrompu ou format invalide (${this.filePath}) : structure ShopState attendue non reconnue.`,
      );
    }
    return data as ShopState;
  }

  public async readState(): Promise<ShopState> {
    try {
      const content = await fs.promises.readFile(this.filePath, 'utf-8');
      try {
        const parsed = JSON.parse(content);
        return this.validateShopState(parsed);
      } catch (parseErr) {
        if (parseErr instanceof SyntaxError) {
          throw new Error(
            `Fichier de données corrompu (JSON invalide) (${this.filePath}) : ${parseErr.message}`,
          );
        }
        throw parseErr;
      }
    } catch (readErr: unknown) {
      if (
        typeof readErr === 'object' &&
        readErr !== null &&
        'code' in readErr &&
        (readErr as { code?: string }).code === 'ENOENT'
      ) {
        return createInitialShopState();
      }
      throw readErr;
    }
  }

  public async transact<T>(
    mutator: (state: ShopState) => Promise<T> | T,
  ): Promise<T> {
    const runTransaction = async (): Promise<T> => {
      // 1. Read current state (throws if corrupted, initial if absent)
      const currentState = await this.readState();
      const workingCopy = structuredClone(currentState);

      // 2. Mutate working copy
      const result = await mutator(workingCopy);

      // 3. Atomic write: write to temp file then rename
      const dir = path.dirname(this.filePath);
      await fs.promises.mkdir(dir, { recursive: true });

      const tempFile = path.join(
        dir,
        `.tmp.${path.basename(this.filePath)}.${Date.now()}.${Math.random().toString(36).slice(2)}`,
      );

      try {
        await fs.promises.writeFile(
          tempFile,
          JSON.stringify(workingCopy, null, 2),
          'utf-8',
        );
        await fs.promises.rename(tempFile, this.filePath);
      } catch (writeErr) {
        try {
          await fs.promises.unlink(tempFile);
        } catch {
          // ignore cleanup error
        }
        throw writeErr;
      }

      return result;
    };

    const nextPromise = this.queue.then(runTransaction, runTransaction);
    this.queue = nextPromise.catch(() => {});
    return nextPromise;
  }
}
