import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { describe, expect, it } from 'vitest';
import { Shop } from '../src/domain/shop.js';
import { InMemoryStore } from '../src/adapters/store/in-memory-store.js';
import { JsonFileStore } from '../src/adapters/store/json-file-store.js';
import {
  canTransitionOrder,
  transitionToCancelled,
  transitionToConfirmed,
  transitionToRefused,
} from '../src/domain/order-lifecycle.js';
import type { RecordedOrder, ShopState } from '../src/ports/shop-store.js';

describe('Cycle de vie des commandes (order-lifecycle & Shop)', () => {
  describe('Transitions pures', () => {
    const pendingOrder: RecordedOrder = {
      numero: 1,
      numero_commande: 'CMD-1',
      chatId: 'client-1',
      client_nom: 'Afi Client',
      zone: 'Cotonou',
      articles: [
        {
          ref: 'P01',
          nom: 'Pagne wax 6 yards',
          quantite: 1,
          prix_unitaire_fcfa: 12000,
          sous_total_fcfa: 12000,
        },
      ],
      lignes: [],
      frais_livraison_fcfa: 1000,
      frais: 1000,
      total_fcfa: 13000,
      total: 13000,
      statut: 'en_attente_afi',
      date: '2026-11-04T10:00:00Z',
    };

    it('seule en_attente_afi peut évoluer', () => {
      expect(canTransitionOrder(pendingOrder)).toBe(true);
      expect(canTransitionOrder({ ...pendingOrder, statut: 'confirmee' })).toBe(false);
      expect(canTransitionOrder({ ...pendingOrder, statut: 'refusee' })).toBe(false);
      expect(canTransitionOrder({ ...pendingOrder, statut: 'annulee' })).toBe(false);
    });

    it('transitionToConfirmed préserve les données immuables et met à jour statut/decidedAt/decidedBy', () => {
      const res = transitionToConfirmed(pendingOrder, {
        decidedAt: '2026-11-04T10:05:00Z',
        decidedBy: 'afi',
      });
      expect(res.success).toBe(true);
      if (res.success) {
        expect(res.order.statut).toBe('confirmee');
        expect(res.order.decidedAt).toBe('2026-11-04T10:05:00Z');
        expect(res.order.decidedBy).toBe('afi');
        expect(res.order.client_nom).toBe(pendingOrder.client_nom);
        expect(res.order.total_fcfa).toBe(pendingOrder.total_fcfa);
        expect(res.order.articles).toEqual(pendingOrder.articles);
      }
    });

    it('transitionToRefused enregistre la raison et passe en refusee', () => {
      const res = transitionToRefused(pendingOrder, {
        raison: 'rupture chez le grossiste',
      });
      expect(res.success).toBe(true);
      if (res.success) {
        expect(res.order.statut).toBe('refusee');
        expect(res.order.raison).toBe('rupture chez le grossiste');
        expect(res.order.decidedBy).toBe('afi');
      }
    });

    it('transitionToCancelled passe en annulee avec raison', () => {
      const res = transitionToCancelled(pendingOrder, {
        raison: 'client injoignable',
      });
      expect(res.success).toBe(true);
      if (res.success) {
        expect(res.order.statut).toBe('annulee');
        expect(res.order.raison).toBe('client injoignable');
        expect(res.order.decidedBy).toBe('system');
      }
    });

    it('refuse toute transition sur une commande déjà traitée', () => {
      const confirmedOrder: RecordedOrder = {
        ...pendingOrder,
        statut: 'confirmee',
      };
      const res = transitionToConfirmed(confirmedOrder);
      expect(res.success).toBe(false);
      if (!res.success) {
        expect(res.reason).toBe('deja_traitee');
        expect(res.current.statut).toBe('confirmee');
      }
    });
  });

  describe('Shop - soumission, approbation, refus, annulation et concurrence', () => {
    it('soumission sans écriture de stock', async () => {
      const shop = new Shop();
      const stockAvant = await shop.checkStock('P01');
      expect(stockAvant?.stock).toBe(14);

      const res = await shop.submitOrderForApproval({
        chatId: 'chat-001',
        clientNom: 'Koffi',
        zone: 'Calavi',
        articles: [{ ref: 'P01', quantite: 2 }],
      });

      expect(res.success).toBe(true);
      if (res.success) {
        expect(res.numero).toBe(1);
        expect(res.cancelledNumbers).toEqual([]);
        expect(res.order.statut).toBe('en_attente_afi');
      }

      // Stock n'est pas décrémenté
      const stockApres = await shop.checkStock('P01');
      expect(stockApres?.stock).toBe(14);
    });

    it('approbation -> confirmee et stock décrémenté dans la même transaction', async () => {
      const shop = new Shop();
      const sub = await shop.submitOrderForApproval({
        chatId: 'chat-001',
        clientNom: 'Koffi',
        zone: 'Calavi',
        articles: [{ ref: 'P01', quantite: 4 }],
      });
      expect(sub.success).toBe(true);
      if (!sub.success) return;

      const app = await shop.approveOrder(sub.numero);
      expect(app.status).toBe('ok');
      if (app.status === 'ok') {
        expect(app.order.statut).toBe('confirmee');
        expect(app.order.decidedBy).toBe('afi');
      }

      // Stock décrémenté de 14 - 4 = 10
      const stock = await shop.checkStock('P01');
      expect(stock?.stock).toBe(10);
    });

    it('refus de commande -> refusee sans modification de stock', async () => {
      const shop = new Shop();
      const sub = await shop.submitOrderForApproval({
        chatId: 'chat-001',
        clientNom: 'Amina',
        zone: 'Cotonou',
        articles: [{ ref: 'P02', quantite: 1 }],
      });
      if (!sub.success) return;

      const rej = await shop.rejectOrder(sub.numero, 'fermeture exceptionnelle');
      expect(rej.status).toBe('ok');
      if (rej.status === 'ok') {
        expect(rej.order.statut).toBe('refusee');
        expect(rej.order.raison).toBe('fermeture exceptionnelle');
      }

      const stock = await shop.checkStock('P02');
      expect(stock?.stock).toBe(3);
    });

    it('deux approbations simultanées (Promise.all) -> exactement une transition vers confirmee', async () => {
      const shop = new Shop();
      const sub = await shop.submitOrderForApproval({
        chatId: 'chat-conc',
        clientNom: 'Yao',
        zone: 'Cotonou',
        articles: [{ ref: 'P01', quantite: 2 }],
      });
      if (!sub.success) return;

      // Lance deux approbations concurrentes
      const [res1, res2] = await Promise.all([
        shop.approveOrder(sub.numero),
        shop.approveOrder(sub.numero),
      ]);

      const statuses = [res1.status, res2.status];
      expect(statuses).toContain('ok');
      expect(statuses).toContain('deja_traitee');

      // Stock n'a été décrémenté qu'une seule fois (14 - 2 = 12)
      const stock = await shop.checkStock('P01');
      expect(stock?.stock).toBe(12);
    });

    it('approbation d une commande annulée -> deja_traitee', async () => {
      const shop = new Shop();
      const sub = await shop.submitOrderForApproval({
        chatId: 'chat-cancel',
        clientNom: 'Sena',
        zone: 'Porto-Novo',
        articles: [{ ref: 'P01', quantite: 1 }],
      });
      if (!sub.success) return;

      await shop.cancelOrder(sub.numero, 'annulation par client');

      const app = await shop.approveOrder(sub.numero);
      expect(app.status).toBe('deja_traitee');
      if (app.status === 'deja_traitee') {
        expect(app.current.statut).toBe('annulee');
      }
    });

    it('stock insuffisant à l approbation -> annulee_stock sans écriture de stock', async () => {
      // P02 a stock initial de 3
      const shop = new Shop();

      // Soumet commande A pour 2 unités de P02
      const subA = await shop.submitOrderForApproval({
        chatId: 'chat-a',
        clientNom: 'Client A',
        zone: 'Cotonou',
        articles: [{ ref: 'P02', quantite: 2 }],
      });
      // Soumet commande B pour 2 unités de P02
      const subB = await shop.submitOrderForApproval({
        chatId: 'chat-b',
        clientNom: 'Client B',
        zone: 'Cotonou',
        articles: [{ ref: 'P02', quantite: 2 }],
      });

      if (!subA.success || !subB.success) return;

      // On approuve A d'abord -> stock de P02 passe à 3 - 2 = 1
      const appA = await shop.approveOrder(subA.numero);
      expect(appA.status).toBe('ok');
      const stockIntermediaire = await shop.checkStock('P02');
      expect(stockIntermediaire?.stock).toBe(1);

      // On tente d'approuver B (qui demande 2 unités alors qu'il n'en reste qu'1)
      const appB = await shop.approveOrder(subB.numero);
      expect(appB.status).toBe('annulee_stock');
      if (appB.status === 'annulee_stock') {
        expect(appB.raison).toContain('stock insuffisant pour Chemise bazin homme');
      }

      // Le stock reste à 1 (aucune écriture négative ni partielle)
      const stockFinal = await shop.checkStock('P02');
      expect(stockFinal?.stock).toBe(1);

      // Et la commande B est passée au statut annulee
      const allOrders = await shop.getOrders();
      const orderB = allOrders.find((o) => o.numero === subB.numero);
      expect(orderB?.statut).toBe('annulee');
      expect(orderB?.raison).toContain('stock insuffisant');
    });

    it('nouvelle soumission du même chatId annule l ancienne en attente, pas celle d un autre chatId', async () => {
      const shop = new Shop();

      // Client 1 soumet commande 1
      const sub1 = await shop.submitOrderForApproval({
        chatId: 'client-1',
        clientNom: 'Client 1',
        zone: 'Cotonou',
        articles: [{ ref: 'P01', quantite: 1 }],
      });

      // Client 2 soumet commande 2
      const sub2 = await shop.submitOrderForApproval({
        chatId: 'client-2',
        clientNom: 'Client 2',
        zone: 'Calavi',
        articles: [{ ref: 'P01', quantite: 1 }],
      });

      if (!sub1.success || !sub2.success) return;

      // Client 1 soumet une NOUVELLE commande 3
      const sub3 = await shop.submitOrderForApproval({
        chatId: 'client-1',
        clientNom: 'Client 1',
        zone: 'Akpakpa',
        articles: [{ ref: 'P04', quantite: 2 }],
      });

      expect(sub3.success).toBe(true);
      if (sub3.success) {
        expect(sub3.numero).toBe(3);
        expect(sub3.cancelledNumbers).toEqual([sub1.numero]);
      }

      const all = await shop.getOrders();
      const c1 = all.find((o) => o.numero === sub1.numero);
      const c2 = all.find((o) => o.numero === sub2.numero);
      const c3 = all.find((o) => o.numero === sub3.numero);

      // c1 est annulée
      expect(c1?.statut).toBe('annulee');
      // c2 d'un autre client est TOUJOURS en attente
      expect(c2?.statut).toBe('en_attente_afi');
      // c3 est en attente
      expect(c3?.statut).toBe('en_attente_afi');
    });

    it('numérotation séquentielle persistée', async () => {
      const shop = new Shop();
      const s1 = await shop.submitOrderForApproval({
        chatId: 'c1',
        clientNom: 'N1',
        zone: 'Cotonou',
        articles: [{ ref: 'P01', quantite: 1 }],
      });
      const s2 = await shop.submitOrderForApproval({
        chatId: 'c2',
        clientNom: 'N2',
        zone: 'Cotonou',
        articles: [{ ref: 'P01', quantite: 1 }],
      });

      if (s1.success && s2.success) {
        expect(s1.numero).toBe(1);
        expect(s2.numero).toBe(2);
      }
    });

    it('compatibilité JsonFileStore avec ancien état sans chatId', async () => {
      const tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'boutique-test-'));
      const filePath = path.join(tmpDir, 'legacy-shop.json');

      // État pré-existant contenant une commande confirmée sans chatId ni numero explicite
      const legacyState: ShopState = {
        stock: { P01: 10, P02: 5 },
        commandes: [
          {
            numero_commande: 'CMD-1',
            client_nom: 'Client Ancien',
            zone: 'Cotonou',
            articles: [
              {
                ref: 'P01',
                nom: 'Pagne wax',
                quantite: 1,
                prix_unitaire_fcfa: 12000,
                sous_total_fcfa: 12000,
              },
            ],
            lignes: [],
            frais_livraison_fcfa: 1000,
            frais: 1000,
            total_fcfa: 13000,
            total: 13000,
            statut: 'confirmee',
            date: '2026-10-01T00:00:00Z',
          },
        ],
        prochain_numero: 2,
      };

      await fs.promises.writeFile(filePath, JSON.stringify(legacyState, null, 2), 'utf-8');

      const store = new JsonFileStore(filePath);
      const shop = new Shop(store);

      const orders = await shop.getOrders();
      expect(orders).toHaveLength(1);
      expect(orders[0]?.numero_commande).toBe('CMD-1');
      expect(orders[0]?.statut).toBe('confirmee');
      expect(orders[0]?.chatId).toBeUndefined();

      // Soumettre une nouvelle commande incrémente bien depuis prochain_numero (2)
      const sub = await shop.submitOrderForApproval({
        chatId: 'nouveau-client',
        clientNom: 'Client Nouveau',
        zone: 'Calavi',
        articles: [{ ref: 'P01', quantite: 1 }],
      });

      expect(sub.success).toBe(true);
      if (sub.success) {
        expect(sub.numero).toBe(2);
        expect(sub.order.chatId).toBe('nouveau-client');
      }

      await fs.promises.rm(tmpDir, { recursive: true, force: true });
    });
  });
});
