import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { JsonFileStore } from '../src/adapters/store/json-file-store.js';
import { Shop } from '../src/domain/shop.js';

describe('Shop - Persistence & Preview', () => {
  let tempDir: string;
  let filePath: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'boutique-shop-test-'));
    filePath = path.join(tempDir, 'shop.json');
  });

  afterEach(() => {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  it('previewOrder valide la commande SANS aucun effet de bord', async () => {
    const store = new JsonFileStore(filePath);
    const shop = new Shop(store);

    const initialStock = (await shop.checkStock('P01'))?.stock;
    expect(initialStock).toBe(14);

    const previewResult = await shop.previewOrder({
      clientNom: 'Koffi Mensah',
      zone: 'Cotonou',
      articles: [{ ref: 'P01', quantite: 2 }],
    });

    expect(previewResult.success).toBe(true);
    if (!previewResult.success) return;

    expect(previewResult.preview.client_nom).toBe('Koffi Mensah');
    expect(previewResult.preview.zone).toBe('Cotonou');
    expect(previewResult.preview.articles).toHaveLength(1);
    expect(previewResult.preview.articles[0]?.quantite).toBe(2);
    expect(previewResult.preview.articles[0]?.sous_total_fcfa).toBe(24000);
    expect(previewResult.preview.frais_livraison_fcfa).toBe(1000);
    expect(previewResult.preview.total_fcfa).toBe(25000);

    // Verify ZERO side effects
    const stockAfterPreview = (await shop.checkStock('P01'))?.stock;
    expect(stockAfterPreview).toBe(14);
    const ordersAfterPreview = await shop.getOrders();
    expect(ordersAfterPreview).toHaveLength(0);
  });

  it('deux commandes successives pour le dernier exemplaire -> la seconde échoue avec "stock insuffisant"', async () => {
    const store = new JsonFileStore(filePath);
    const shop = new Shop(store);

    // P02 (Chemise bazin homme) has initial stock = 3
    const checkP02 = await shop.checkStock('P02');
    expect(checkP02?.stock).toBe(3);

    // 1ère commande : prend les 3 exemplaires
    const firstOrder = await shop.placeOrder({
      clientNom: 'Client 1',
      zone: 'Akpakpa',
      articles: [{ ref: 'P02', quantite: 3 }],
    });

    expect(firstOrder.success).toBe(true);
    if (!firstOrder.success) return;
    expect(firstOrder.order.numero_commande).toBe('CMD-1');

    const stockAfterFirst = (await shop.checkStock('P02'))?.stock;
    expect(stockAfterFirst).toBe(0);

    // 2ème commande : tente de commander 1 exemplaire du même produit
    const secondOrder = await shop.placeOrder({
      clientNom: 'Client 2',
      zone: 'Cotonou',
      articles: [{ ref: 'P02', quantite: 1 }],
    });

    expect(secondOrder.success).toBe(false);
    if (secondOrder.success) return;

    expect(secondOrder.reason).toBe('INSUFFICIENT_STOCK');
    if (secondOrder.reason === 'INSUFFICIENT_STOCK') {
      expect(secondOrder.message).toContain('stock insuffisant pour Chemise bazin homme');
      expect(secondOrder.stock_disponible).toBe(0);
    }

    // Stock stays at 0, only 1 order recorded
    const finalStock = (await shop.checkStock('P02'))?.stock;
    expect(finalStock).toBe(0);
    const orders = await shop.getOrders();
    expect(orders).toHaveLength(1);
  });

  it('décrément persisté : le stock et la commande sont conservés sur disque entre instances', async () => {
    const store1 = new JsonFileStore(filePath);
    const shop1 = new Shop(store1);

    // Initial stock for P05 (Robe en wax) is 5
    expect((await shop1.checkStock('P05'))?.stock).toBe(5);

    const orderResult = await shop1.placeOrder({
      clientNom: 'Afi',
      zone: 'Calavi',
      articles: [{ ref: 'P05', quantite: 2 }],
    });

    expect(orderResult.success).toBe(true);
    if (!orderResult.success) return;

    expect(orderResult.order.numero_commande).toBe('CMD-1');
    expect(orderResult.order.total_fcfa).toBe(46000);
    expect(orderResult.order.statut).toBe('confirmee');
    expect(orderResult.order.date).toBeDefined();

    // Verify on disk file exists
    expect(fs.existsSync(filePath)).toBe(true);
    const fileContent = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    expect(fileContent.stock['P05']).toBe(3);
    expect(fileContent.commandes).toHaveLength(1);
    expect(fileContent.commandes[0].numero_commande).toBe('CMD-1');

    // Second Shop instance reading from the same file
    const store2 = new JsonFileStore(filePath);
    const shop2 = new Shop(store2);

    expect((await shop2.checkStock('P05'))?.stock).toBe(3);
    const orders2 = await shop2.getOrders();
    expect(orders2).toHaveLength(1);
    expect(orders2[0]?.numero_commande).toBe('CMD-1');
    expect(orders2[0]?.total_fcfa).toBe(46000);
  });
});
