import { describe, expect, it } from 'vitest';
import type { RecordedOrder } from '../src/ports/shop-store.js';
import {
  afiAck,
  afiAlreadyDecided,
  afiHelp,
  afiRecap,
  afiUnknownOrder,
  clientOrderCancelledStock,
  clientOrderConfirmed,
  clientOrderRefused,
  clientOrderReplaced,
  formatAmount,
  nonAfiCommandRefused,
} from '../src/messages/templates.js';

describe('Messages fixes (src/messages/templates.ts)', () => {
  const sampleOrder: RecordedOrder = {
    numero: 12,
    numero_commande: 'CMD-12',
    chatId: '22997000000@c.us',
    client_nom: 'Afi',
    zone: 'Calavi',
    articles: [
      {
        ref: 'P05',
        nom: 'Robe en wax',
        quantite: 2,
        prix_unitaire_fcfa: 22000,
        sous_total_fcfa: 44000,
      },
    ],
    lignes: [],
    frais_livraison_fcfa: 2000,
    frais: 2000,
    total_fcfa: 46000,
    total: 46000,
    statut: 'en_attente_afi',
    date: '2026-11-04T12:00:00Z',
  };

  it('formatAmount utilise des espaces standards (\\u0020)', () => {
    expect(formatAmount(46000)).toBe('46 000');
    expect(formatAmount(1200500)).toBe('1 200 500');
    expect(formatAmount(500)).toBe('500');
  });

  it('afiRecap génère exactement le format spécifié par le prompt', () => {
    const recap = afiRecap(sampleOrder);
    expect(recap).toBe(
      'Commande #12 : 2 x Robe en wax, Calavi, 46 000 FCFA. Client : Afi (22997000000). Répondez OUI 12 ou NON 12',
    );
  });

  it('afiRecap gère les numéros de commande sous forme CMD-12 si numero est absent', () => {
    const orderWithoutNum: RecordedOrder = {
      ...sampleOrder,
      numero: undefined,
    };
    expect(afiRecap(orderWithoutNum)).toBe(
      'Commande #12 : 2 x Robe en wax, Calavi, 46 000 FCFA. Client : Afi (22997000000). Répondez OUI 12 ou NON 12',
    );
  });

  it('clientOrderConfirmed génère une confirmation polie en 1-2 phrases', () => {
    const msg = clientOrderConfirmed(sampleOrder);
    expect(msg).toBe(
      'Votre commande #12 est confirmée par la boutique. Elle vous sera livrée à Calavi.',
    );
  });

  it('clientOrderRefused informe le client poliment avec ou sans raison', () => {
    const msgWithoutRaison = clientOrderRefused(sampleOrder);
    expect(msgWithoutRaison).toBe(
      "Votre commande #12 n'a pas été validée par la boutique. N'hésitez pas à nous recontacter pour toute autre demande.",
    );

    const msgWithRaison = clientOrderRefused({
      ...sampleOrder,
      raison: 'horaires de fermeture exceptionnels',
    });
    expect(msgWithRaison).toBe(
      "Votre commande #12 n'a pas été validée par la boutique. Raison : horaires de fermeture exceptionnels. N'hésitez pas à nous recontacter pour toute autre demande.",
    );
  });

  it('clientOrderCancelledStock annonce la rupture de stock avec courtoisie', () => {
    const msg = clientOrderCancelledStock({
      ...sampleOrder,
      raison: 'stock insuffisant pour Robe en wax',
    });
    expect(msg).toBe(
      "Votre commande #12 a dû être annulée en raison d'une rupture de stock (stock insuffisant pour Robe en wax). Nous vous prions de nous en excuser.",
    );
  });

  it('clientOrderReplaced indique l annulation de l ancienne commande', () => {
    expect(clientOrderReplaced(12)).toBe(
      'Votre commande #12 en attente a été annulée et remplacée par votre nouvelle commande.',
    );
    expect(clientOrderReplaced('CMD-12')).toBe(
      'Votre commande #12 en attente a été annulée et remplacée par votre nouvelle commande.',
    );
  });

  it('afiAck accuse réception des décisions oui et non', () => {
    expect(afiAck(sampleOrder, 'oui')).toBe('Commande #12 validée avec succès.');
    expect(afiAck(sampleOrder, 'non')).toBe('Commande #12 refusée.');
  });

  it('afiAlreadyDecided avertit Afi que la commande a déjà été traitée', () => {
    expect(afiAlreadyDecided(12, 'confirmee')).toBe(
      'La commande #12 a déjà été traitée (statut : confirmee).',
    );
  });

  it('afiUnknownOrder signale un numéro introuvable', () => {
    expect(afiUnknownOrder(99)).toBe('La commande #99 est introuvable.');
  });

  it('afiHelp rappelle la syntaxe autorisée', () => {
    expect(afiHelp()).toBe(
      'Pour traiter une commande, répondez par OUI <numéro> ou NON <numéro> (ex : OUI 12).',
    );
  });

  it('nonAfiCommandRefused refuse les tiers', () => {
    expect(nonAfiCommandRefused()).toBe(
      'Action non autorisée. Seule Afi peut valider ou refuser les commandes de la boutique.',
    );
  });
});
