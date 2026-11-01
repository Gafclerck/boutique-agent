import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { InMemoryStore } from '../src/adapters/store/in-memory-store.js';
import { JsonFileStore } from '../src/adapters/store/json-file-store.js';
import { INITIAL_PRODUCTS } from '../src/domain/catalogue.js';
import type { ShopStore } from '../src/ports/shop-store.js';

describe('ShopStore Contract Tests', () => {
  const storeFactories: Array<{
    name: string;
    createStore: () => { store: ShopStore; cleanup?: () => void };
  }> = [
    {
      name: 'InMemoryStore',
      createStore: () => ({
        store: new InMemoryStore(),
      }),
    },
    {
      name: 'JsonFileStore',
      createStore: () => {
        const tempDir = fs.mkdtempSync(
          path.join(os.tmpdir(), 'boutique-store-test-'),
        );
        const filePath = path.join(tempDir, 'shop.json');
        return {
          store: new JsonFileStore(filePath),
          cleanup: () => {
            try {
              fs.rmSync(tempDir, { recursive: true, force: true });
            } catch {
              // ignore cleanup errors
            }
          },
        };
      },
    },
  ];

  for (const { name, createStore } of storeFactories) {
    describe(`${name} contract`, () => {
      let store: ShopStore;
      let cleanup: (() => void) | undefined;

      beforeEach(() => {
        const created = createStore();
        store = created.store;
        cleanup = created.cleanup;
      });

      afterEach(() => {
        cleanup?.();
      });

      it('lecture initiale : retourne le stock complet du catalogue, aucune commande, numéro 1', async () => {
        const state = await store.readState();
        expect(state.commandes).toEqual([]);
        expect(state.prochain_numero).toBe(1);

        for (const product of INITIAL_PRODUCTS) {
          expect(state.stock[product.ref]).toBe(product.stock);
        }
      });

      it('transaction réussie : met à jour le stock et enregistre la commande', async () => {
        const result = await store.transact((state) => {
          state.stock['P01'] = 10;
          state.commandes.push({
            numero_commande: 'CMD-1',
            client_nom: 'Koffi',
            zone: 'Cotonou',
            articles: [],
            lignes: [],
            frais_livraison_fcfa: 1000,
            frais: 1000,
            total_fcfa: 25000,
            total: 25000,
            statut: 'confirmee',
            date: new Date().toISOString(),
          });
          state.prochain_numero = 2;
          return 'ok';
        });

        expect(result).toBe('ok');

        const postState = await store.readState();
        expect(postState.stock['P01']).toBe(10);
        expect(postState.commandes).toHaveLength(1);
        expect(postState.commandes[0]?.numero_commande).toBe('CMD-1');
        expect(postState.prochain_numero).toBe(2);
      });

      it('transaction qui échoue : rien n’est écrit si le mutateur lève une exception', async () => {
        const initialState = await store.readState();
        const initialP01Stock = initialState.stock['P01'];
        expect(initialP01Stock).toBe(14);

        await expect(
          store.transact((state) => {
            state.stock['P01'] = 0;
            state.commandes.push({
              numero_commande: 'CMD-CRASH',
              client_nom: 'Crash',
              zone: 'Cotonou',
              articles: [],
              lignes: [],
              frais_livraison_fcfa: 1000,
              frais: 1000,
              total_fcfa: 1000,
              total: 1000,
              statut: 'confirmee',
              date: new Date().toISOString(),
            });
            throw new Error('Erreur simulée dans la transaction');
          }),
        ).rejects.toThrow('Erreur simulée dans la transaction');

        // Verify state is completely unchanged
        const stateAfterFailure = await store.readState();
        expect(stateAfterFailure.stock['P01']).toBe(initialP01Stock);
        expect(stateAfterFailure.commandes).toHaveLength(0);
        expect(stateAfterFailure.prochain_numero).toBe(1);
      });

      it('numérotation : incrémente le prochain numéro séquentiellement', async () => {
        await store.transact((state) => {
          expect(state.prochain_numero).toBe(1);
          state.prochain_numero = 2;
        });

        await store.transact((state) => {
          expect(state.prochain_numero).toBe(2);
          state.prochain_numero = 3;
        });

        const finalState = await store.readState();
        expect(finalState.prochain_numero).toBe(3);
      });

      it('sérialisation : 20 transactions concurrentes ne perdent aucune mise à jour', async () => {
        const promises = Array.from({ length: 20 }, (_, i) =>
          store.transact((state) => {
            state.prochain_numero = (state.prochain_numero ?? 1) + 1;
            return i;
          }),
        );

        const results = await Promise.all(promises);
        expect(results).toHaveLength(20);

        const finalState = await store.readState();
        expect(finalState.prochain_numero).toBe(21);
      });

      it('résilience : une transaction qui échoue ne bloque pas la file', async () => {
        const results: string[] = [];

        const tx1 = store.transact(() => {
          results.push('tx1');
          return 'ok1';
        });

        const txFail = store.transact(() => {
          results.push('txFail');
          throw new Error('erreur transaction');
        });

        const tx2 = store.transact(() => {
          results.push('tx2');
          return 'ok2';
        });

        await expect(tx1).resolves.toBe('ok1');
        await expect(txFail).rejects.toThrow('erreur transaction');
        await expect(tx2).resolves.toBe('ok2');

        expect(results).toEqual(['tx1', 'txFail', 'tx2']);
      });
    });
  }

  describe('JsonFileStore Specifics', () => {
    let tempDir: string;
    let filePath: string;

    beforeEach(() => {
      tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'boutique-json-test-'));
      filePath = path.join(tempDir, 'shop.json');
    });

    afterEach(() => {
      try {
        fs.rmSync(tempDir, { recursive: true, force: true });
      } catch {
        // ignore
      }
    });

    it('persistance entre deux instances partageant le même fichier', async () => {
      const storeInstance1 = new JsonFileStore(filePath);
      await storeInstance1.transact((state) => {
        state.stock['P05'] = 2;
        state.commandes.push({
          numero_commande: 'CMD-1',
          client_nom: 'Afi',
          zone: 'Calavi',
          articles: [],
          lignes: [],
          frais_livraison_fcfa: 2000,
          frais: 2000,
          total_fcfa: 46000,
          total: 46000,
          statut: 'confirmee',
          date: '2026-11-01T14:00:00.000Z',
        });
        state.prochain_numero = 2;
      });

      // Second instance reads from disk
      const storeInstance2 = new JsonFileStore(filePath);
      const state2 = await storeInstance2.readState();
      expect(state2.stock['P05']).toBe(2);
      expect(state2.commandes).toHaveLength(1);
      expect(state2.commandes[0]?.client_nom).toBe('Afi');
      expect(state2.prochain_numero).toBe(2);
    });

    it('fichier corrompu (JSON invalide) -> lève une erreur explicite, ne réinitialise JAMAIS', async () => {
      fs.writeFileSync(filePath, '{ ceci n\'est pas du json valide !!!', 'utf-8');

      const corruptedStore = new JsonFileStore(filePath);

      await expect(corruptedStore.readState()).rejects.toThrow(
        /corrompu/i,
      );

      // Verify that the file was NOT silently overwritten or deleted
      const contentAfter = fs.readFileSync(filePath, 'utf-8');
      expect(contentAfter).toContain('ceci n\'est pas du json');
    });

    it('fichier corrompu (structure invalide) -> lève une erreur explicite', async () => {
      fs.writeFileSync(filePath, JSON.stringify({ invalid: true }), 'utf-8');

      const corruptedStore = new JsonFileStore(filePath);
      await expect(corruptedStore.readState()).rejects.toThrow(
        /corrompu/i,
      );
    });
  });
});
