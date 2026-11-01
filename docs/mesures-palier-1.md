# Mesures de Base - Palier 1.2

Ce document consigne les mesures de performance et de conformité obtenues sur 5 scénarios exécutés 5 fois chacun (25 exécutions au total) après application du correctif de recherche multi-mots.

---

## 1. Environnement de Mesure

- **Modèle LLM** : `anthropic/claude-haiku-4-5-20251001` (via API Rodium AI)
- **Température** : 0 (reproductibilité déterministe)
- **Nombre d'essais** : 5 exécutions indépendantes par scénario via `npm run ask`
- **Date des mesures** : 1er novembre 2026

---

## 2. Tableau de Synthèse par Scénario

| Scénario | Requête client | Taux de réussite | Appels LLM (moy.) | Tokens (moy.) | Diagnostic |
| :--- | :--- | :---: | :---: | :---: | :--- |
| **S1** | *"Vous avez des pagnes ? Combien ça fait en euros pour ma soeur à Paris ?"* | **5/5 (100 %)** | 3,0 | 8 136 | **OK** : recherche (`chercher_produits`), stock (`verifier_stock`) et conversion (`convertir_devise`) conformes. Montant converti exact (18,29 EUR). |
| **S2** | *"Livrez-moi à Lomé."* | **5/5 (100 %)** | 2,0 | 5 108 | **OK** : appel de `frais_livraison` détectant la zone non desservie et restitution intégrale des zones disponibles. |
| **S3** | *"C'est combien le sac en raphia ?"* | **0/5 (0 %)** | 2,0 | 5 039 | **ANOMALIE** : le correctif trouve bien P03 (`chercher_produits`), mais `verifier_stock` n'est pas appelé ; l'agent annonce le prix sans détecter la rupture ni proposer d'alternative. |
| **a** | *"Bonjour, vous avez des sacs ?"* | **0/5 (0 %)** | 1,0 | 2 454 | **ANOMALIE** : l'agent demande des précisions sans appeler `chercher_produits` ni `verifier_stock`. |
| **c** | *"Combien coûte une robe en dollars ?"* | **0/5 (0 %)** | 3,0 | 7 894 | **ANOMALIE** : recherche et conversion en USD (37,44 USD) réussies, mais omission de `verifier_stock` avant la réponse. |

---

## 3. Tableau Détaillé des 25 Essais (Scénario × 5 essais)

### Scénario 1 (S1) : *"Vous avez des pagnes ? Combien ça fait en euros pour ma soeur à Paris ?"*
*Critère d'évaluation : `chercher_produits` puis `convertir_devise`, montant converti issu de l'outil.*

| Essai | Séquence d'outils appelés | Verdict | Appels LLM | Tokens cumulés | Détail de la réponse |
| :---: | :--- | :---: | :---: | :---: | :--- |
| 1 | `chercher_produits` → `verifier_stock` → `convertir_devise` | **OK** | 3 | 8 136 | 14 en stock, 12 000 FCFA = 18,29 EUR |
| 2 | `chercher_produits` → `verifier_stock` → `convertir_devise` | **OK** | 3 | 8 136 | 14 en stock, 12 000 FCFA = 18,29 EUR |
| 3 | `chercher_produits` → `verifier_stock` → `convertir_devise` | **OK** | 3 | 8 136 | 14 en stock, 12 000 FCFA = 18,29 EUR |
| 4 | `chercher_produits` → `verifier_stock` → `convertir_devise` | **OK** | 3 | 8 136 | 14 en stock, 12 000 FCFA = 18,29 EUR |
| 5 | `chercher_produits` → `verifier_stock` → `convertir_devise` | **OK** | 3 | 8 136 | 14 en stock, 12 000 FCFA = 18,29 EUR |

---

### Scénario 2 (S2) : *"Livrez-moi à Lomé."*
*Critère d'évaluation : `frais_livraison` renvoie "zone non desservie" et la réponse liste les zones de l'outil.*

| Essai | Séquence d'outils appelés | Verdict | Appels LLM | Tokens cumulés | Détail de la réponse |
| :---: | :--- | :---: | :---: | :---: | :--- |
| 1 | `frais_livraison` | **OK** | 2 | 5 108 | Lomé non desservie, liste Cotonou, Akpakpa, Fidjrossè, Calavi, Porto-Novo, Ouidah |
| 2 | `frais_livraison` | **OK** | 2 | 5 108 | Lomé non desservie, liste Cotonou, Akpakpa, Fidjrossè, Calavi, Porto-Novo, Ouidah |
| 3 | `frais_livraison` | **OK** | 2 | 5 108 | Lomé non desservie, liste Cotonou, Akpakpa, Fidjrossè, Calavi, Porto-Novo, Ouidah |
| 4 | `frais_livraison` | **OK** | 2 | 5 108 | Lomé non desservie, liste Cotonou, Akpakpa, Fidjrossè, Calavi, Porto-Novo, Ouidah |
| 5 | `frais_livraison` | **OK** | 2 | 5 108 | Lomé non desservie, liste Cotonou, Akpakpa, Fidjrossè, Calavi, Porto-Novo, Ouidah |

---

### Scénario 3 (S3) : *"C'est combien le sac en raphia ?"*
*Critère d'évaluation : prix + rupture annoncée + alternative issue d'un résultat d'outil.*

| Essai | Séquence d'outils appelés | Verdict | Appels LLM | Tokens cumulés | Détail de la réponse |
| :---: | :--- | :---: | :---: | :---: | :--- |
| 1 | `chercher_produits` | **ANOMALIE** | 2 | 5 039 | Prix 7 500 FCFA annoncé, mais `verifier_stock` non appelé (rupture ignorée) |
| 2 | `chercher_produits` | **ANOMALIE** | 2 | 5 039 | Prix 7 500 FCFA annoncé, mais `verifier_stock` non appelé (rupture ignorée) |
| 3 | `chercher_produits` | **ANOMALIE** | 2 | 5 039 | Prix 7 500 FCFA annoncé, mais `verifier_stock` non appelé (rupture ignorée) |
| 4 | `chercher_produits` | **ANOMALIE** | 2 | 5 039 | Prix 7 500 FCFA annoncé, mais `verifier_stock` non appelé (rupture ignorée) |
| 5 | `chercher_produits` | **ANOMALIE** | 2 | 5 039 | Prix 7 500 FCFA annoncé, mais `verifier_stock` non appelé (rupture ignorée) |

---

### Scénario a : *"Bonjour, vous avez des sacs ?"*
*Critère d'évaluation : `verifier_stock` appelé avant la réponse.*

| Essai | Séquence d'outils appelés | Verdict | Appels LLM | Tokens cumulés | Détail de la réponse |
| :---: | :--- | :---: | :---: | :---: | :--- |
| 1 | *(aucun)* | **ANOMALIE** | 1 | 2 454 | Demande de précisions sans vérification de stock préalable |
| 2 | *(aucun)* | **ANOMALIE** | 1 | 2 454 | Demande de précisions sans vérification de stock préalable |
| 3 | *(aucun)* | **ANOMALIE** | 1 | 2 454 | Demande de précisions sans vérification de stock préalable |
| 4 | *(aucun)* | **ANOMALIE** | 1 | 2 454 | Demande de précisions sans vérification de stock préalable |
| 5 | *(aucun)* | **ANOMALIE** | 1 | 2 454 | Demande de précisions sans vérification de stock préalable |

---

### Scénario c : *"Combien coûte une robe en dollars ?"*
*Critère d'évaluation : `verifier_stock` appelé avant la réponse.*

| Essai | Séquence d'outils appelés | Verdict | Appels LLM | Tokens cumulés | Détail de la réponse |
| :---: | :--- | :---: | :---: | :---: | :--- |
| 1 | `chercher_produits` → `convertir_devise` | **ANOMALIE** | 3 | 7 894 | Prix 22 000 FCFA = 37,44 USD exact, mais `verifier_stock` non appelé |
| 2 | `chercher_produits` → `convertir_devise` | **ANOMALIE** | 3 | 7 894 | Prix 22 000 FCFA = 37,44 USD exact, mais `verifier_stock` non appelé |
| 3 | `chercher_produits` → `convertir_devise` | **ANOMALIE** | 3 | 7 894 | Prix 22 000 FCFA = 37,44 USD exact, mais `verifier_stock` non appelé |
| 4 | `chercher_produits` → `convertir_devise` | **ANOMALIE** | 3 | 7 894 | Prix 22 000 FCFA = 37,44 USD exact, mais `verifier_stock` non appelé |
| 5 | `chercher_produits` → `convertir_devise` | **ANOMALIE** | 3 | 7 894 | Prix 22 000 FCFA = 37,44 USD exact, mais `verifier_stock` non appelé |

---

## 4. Analyse et Observations

1. **Impact du correctif de recherche multi-mots** :
   - Dans le Scénario 3, le mot-clé `"sac raphia"` renvoie désormais immédiatement le produit `P03` (`Sac en raphia` à 7 500 FCFA). L'erreur d'observation `aucun produit pour sac raphia` a totalement disparu.
2. **Identification des anomalies de base liées à `verifier_stock`** :
   - Dès qu'un client s'intéresse à un produit précis par son prix ou son type (Scénarios 3, a, c), le LLM actuel a tendance à répondre directement dès qu'il a le prix ou à demander des précisions sans appeler systématiquement `verifier_stock`.
   - Conformément aux consignes du sujet, ces anomalies **ne sont pas corrigées ici** et constituent la ligne de base quantitative avant les améliorations du Palier 2a.
