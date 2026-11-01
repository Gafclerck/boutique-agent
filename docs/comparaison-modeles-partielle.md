# Comparaison Partielle des Modèles - Palier 2

> **Statut : partiel : solde épuisé**  
> Les tests comparatifs en direct ont été interrompus suite à l'épuisement du solde de crédits RODI. Ce document consigne l'intégralité des mesures et observations obtenues avant interruption.

---

## 1. Modèles Testés et Tarifs

| Modèle | Identifiant (Rodium AI / OpenRouter) | Tarif Prompt (par 1M tokens) | Tarif Complétion (par 1M tokens) | Rôle / Usage visé |
| :--- | :--- | :---: | :---: | :--- |
| **Claude Haiku 4.5** (référence) | `anthropic/claude-haiku-4-5-20251001` | ~1,00 $ / 1,0 RODI | ~5,00 $ / 5,0 RODI | Modèle de base économique |
| **Claude 3.5 Sonnet** | `anthropic/claude-3-5-sonnet-20241022` | ~3,00 $ / 3,0 RODI | ~15,00 $ / 15,0 RODI | Modèle supérieur (raisonnement) |
| **Gemini 2.0 Flash** | `google/gemini-2.0-flash` | ~0,10 $ / 0,1 RODI | ~0,40 $ / 0,4 RODI | Modèle rapide et ultra-économique |

---

## 2. Tableau des Essais Terminés par Cellule

Le protocole initial prévoyait l'évaluation des scénarios S1, S2, S3, a et c. L'épuisement du crédit RODI n'a permis de finaliser que les essais suivants :

| Modèle | S1 (Pagne + EUR) | S2 (Lomé) | S3 (Sac raphia) | a (Demande sacs) | c (Robe USD) | Statut global |
| :--- | :---: | :---: | :---: | :---: | :---: | :--- |
| **Claude Haiku 4.5** | 5/5 | 5/5 | 0/5 | 0/5 | 5/5 | Complet (Palier 1.2) |
| **Claude 3.5 Sonnet** | 1/1 (échec partiel) | Non exécuté | 1/1 (anomalie) | Non exécuté | Non exécuté | **partiel : solde épuisé** |
| **Gemini 2.0 Flash** | 3/3 (100 %) | Non exécuté | Non exécuté | Non exécuté | Non exécuté | **partiel : solde épuisé** |

---

## 3. Observations Détaillées par Modèle

### Claude 3.5 Sonnet
- **Scénario S1** (*"Vous avez des pagnes ? Combien ça fait en euros pour ma soeur à Paris ?"*) :
  - **Observation** : Le modèle a appelé inutilement l'outil `frais_livraison` pour la destination "Paris" en plus de `chercher_produits` et `convertir_devise`. La mention de "Paris" dans l'énoncé du client a déclenché une sur-interprétation de la livraison internationale, alors que la consigne ne demandait qu'une conversion de prix en euros pour la diaspora.
- **Scénario S3** (*"C'est combien le sac en raphia ?"*) :
  - **Observation** : Le modèle identifie la rupture de stock après consultation, annonce correctement l'indisponibilité du sac en raphia, mais propose directement un produit alternatif (ex. pochette ou pagne) **sans avoir au préalable vérifié son stock** via `verifier_stock`. Le critère de rigueur n'est donc pas respecté.

### Google Gemini 2.0 Flash
- **Scénario S1** (*"Vous avez des pagnes ? Combien ça fait en euros pour ma soeur à Paris ?"*) :
  - **Observation** : **3/3 réussites**. Le modèle enchaîne parfaitement la recherche (`chercher_produits`), la vérification de disponibilité (`verifier_stock`) et la conversion (`convertir_devise`). Le montant converti restitué dans la réponse correspond exactement à la valeur retournée par l'outil de devises, sans appel parasite vers `frais_livraison`.

---

## 4. Conclusion et Décision

En raison du solde à 0, la validation de la logique de l'agent ne doit plus dépendre d'appels réels au LLM. Le projet adopte désormais :
1. Une suite de vérificateurs déterministes reposant sur `FakeLlm` et des scénarios codifiés en données.
2. Un script d'exécution live strictement plafonné et protégé, ne s'exécutant jamais sans garde-fous explicites.
