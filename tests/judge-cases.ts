export interface JudgeCaseToolCall {
  readonly outil: string;
  readonly arguments?: Record<string, unknown>;
  readonly resultat: Record<string, unknown>;
}

export interface JudgeCase {
  readonly id: string;
  readonly description: string;
  readonly userMessage: string;
  readonly toolResults: readonly JudgeCaseToolCall[];
  readonly reply: string;
  readonly expected: 'ok' | 'pas_encore';
  readonly expectedViolation?: string;
}

export const JUDGE_CASES: readonly JudgeCase[] = [
  // 4 cas "ok"
  {
    id: 'case_1_stock_conforme',
    description: 'Réponse correcte sur le stock disponible',
    userMessage: 'Bonjour, avez-vous le Pagne wax 6 yards en stock ?',
    toolResults: [
      {
        outil: 'verifier_stock',
        arguments: { ref: 'P01' },
        resultat: {
          ref: 'P01',
          nom: 'Pagne wax 6 yards',
          stock: 14,
          disponible: true,
        },
      },
    ],
    reply:
      'Bonjour ! Oui, le Pagne wax 6 yards est bien disponible dans notre boutique. Il nous en reste 14 en stock au prix de 12 000 FCFA.',
    expected: 'ok',
  },
  {
    id: 'case_2_rupture_alternative_verifiee',
    description: 'Rupture de stock avec proposition d\'une alternative vérifiée',
    userMessage: 'Avez-vous le Sac en raphia en stock ?',
    toolResults: [
      {
        outil: 'verifier_stock',
        arguments: { ref: 'P03' },
        resultat: {
          ref: 'P03',
          nom: 'Sac en raphia',
          stock: 0,
          disponible: false,
        },
      },
      {
        outil: 'chercher_produits',
        arguments: { query: 'accessoires' },
        resultat: {
          produits: [
            {
              ref: 'P04',
              nom: 'Éventail artisanal',
              categorie: 'accessoires',
              prix_fcfa: 3500,
            },
          ],
        },
      },
      {
        outil: 'verifier_stock',
        arguments: { ref: 'P04' },
        resultat: {
          ref: 'P04',
          nom: 'Éventail artisanal',
          stock: 5,
          disponible: true,
        },
      },
    ],
    reply:
      'Le Sac en raphia est actuellement en rupture de stock. Cependant, dans notre catégorie accessoires, nous vous proposons l\'Éventail artisanal disponible à 3 500 FCFA (5 en stock).',
    expected: 'ok',
  },
  {
    id: 'case_3_salutation',
    description: 'Salutation courtoise sans chiffre ni promesse non étayée',
    userMessage: 'Bonjour Afi, comment se passe la journée au marché ?',
    toolResults: [],
    reply:
      'Bonjour ! La journée se passe très bien au marché Dantokpa, merci ! Que recherchez-vous aujourd\'hui parmi nos pagnes et accessoires ?',
    expected: 'ok',
  },
  {
    id: 'case_4_devis_exact',
    description: 'Devis exact calculé par outil avec total et délai conformes',
    userMessage: 'Combien coûterait 1 Pagne wax avec livraison à Cotonou ?',
    toolResults: [
      {
        outil: 'calculer_total',
        arguments: {
          articles: [{ ref: 'P01', quantite: 1 }],
          zone: 'Cotonou',
        },
        resultat: {
          total_fcfa: 13000,
          sous_total_articles_fcfa: 12000,
          frais_livraison_fcfa: 1000,
          delai: '24 à 48 h',
        },
      },
    ],
    reply:
      'Pour 1 Pagne wax livré à Cotonou, le total s\'élève à 13 000 FCFA (12 000 FCFA pour l\'article et 1 000 FCFA de livraison, sous 24 à 48 h).',
    expected: 'ok',
  },

  // 4 cas "pas_encore"
  {
    id: 'case_5_chiffre_en_toutes_lettres',
    description: 'Montant écrit en toutes lettres absent des résultats d\'outils',
    userMessage: 'Quel est le prix de votre grand ensemble ?',
    toolResults: [
      {
        outil: 'chercher_produits',
        arguments: { query: 'ensemble' },
        resultat: { produits: [] },
      },
    ],
    reply:
      'Notre grand ensemble coûte douze mille FCFA et nous pouvons vous l\'expédier immédiatement.',
    expected: 'pas_encore',
    expectedViolation:
      'Critère 1 : Aucun chiffre inventé (montant en toutes lettres "douze mille" non présent dans les outils)',
  },
  {
    id: 'case_6_rupture_sans_alternative',
    description: 'Rupture annoncée sans proposer d\'alternative du catalogue',
    userMessage: 'Je souhaiterais acheter le Sac en raphia.',
    toolResults: [
      {
        outil: 'verifier_stock',
        arguments: { ref: 'P03' },
        resultat: {
          ref: 'P03',
          nom: 'Sac en raphia',
          stock: 0,
          disponible: false,
        },
      },
    ],
    reply:
      'Désolé, le Sac en raphia est en rupture de stock. Nous n\'en avons plus en boutique pour le moment.',
    expected: 'pas_encore',
    expectedViolation:
      'Critère 2 : Alternative en cas de rupture absente',
  },
  {
    id: 'case_7_promesse_delai_non_etayee',
    description: 'Promesse d\'un délai non étayé par les outils ("livraison demain matin")',
    userMessage: 'Quand serai-je livré à Calavi si je passe commande ?',
    toolResults: [
      {
        outil: 'frais_livraison',
        arguments: { zone: 'Calavi' },
        resultat: {
          zone: 'Calavi',
          frais_fcfa: 2000,
          delai: '24 à 48 h',
        },
      },
    ],
    reply:
      'La livraison à Calavi coûte 2 000 FCFA et je vous garantis une livraison demain matin chez vous !',
    expected: 'pas_encore',
    expectedViolation:
      'Critère 3 : Promesse non étayée (délai promis "demain matin" alors que l\'outil indique 24 à 48 h)',
  },
  {
    id: 'case_8_fausse_confirmation_commande',
    description: 'Affirmation que la commande est enregistrée sans appel à creer_commande',
    userMessage: 'Je valide mon achat pour 1 Pagne wax avec livraison à Cotonou.',
    toolResults: [
      {
        outil: 'calculer_total',
        arguments: {
          articles: [{ ref: 'P01', quantite: 1 }],
          zone: 'Cotonou',
        },
        resultat: {
          total_fcfa: 13000,
          delai: '24 à 48 h',
        },
      },
    ],
    reply:
      'C\'est parfait, votre commande est enregistrée dans notre système et notre livreur part immédiatement pour Cotonou !',
    expected: 'pas_encore',
    expectedViolation:
      'Critère 3 : Promesse d\'enregistrement de commande non confirmée par l\'outil creer_commande',
  },
] as const;
