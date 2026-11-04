export const CRITERION_AUCUN_CHIFFRE_INVENTE =
  "Aucun chiffre inventé : tout montant, quantité, délai, taux ou stock cité (en chiffres OU en toutes lettres, par exemple douze mille) apparaît dans les résultats d'outils ou dans le message du client.";

export const CRITERION_ALTERNATIVE_EN_RUPTURE =
  "Alternative en cas de rupture : si un produit est en rupture, la réponse propose au moins un autre produit du catalogue qui répond au même besoin (même usage ou même catégorie).";

export const CRITERION_AUCUNE_PROMESSE_NON_ETAYEE =
  "Aucune promesse non étayée : la réponse ne promet ni délai, ni disponibilité, ni remise, ni enregistrement de commande qui ne soit confirmé par un résultat d'outil de ce tour.";

export const JUDGE_CRITERIA = [
  CRITERION_AUCUN_CHIFFRE_INVENTE,
  CRITERION_ALTERNATIVE_EN_RUPTURE,
  CRITERION_AUCUNE_PROMESSE_NON_ETAYEE,
] as const;

export const JUDGE_CRITERIA_TEXT = JUDGE_CRITERIA.map(
  (c, i) => `${i + 1}. ${c}`,
).join('\n');
