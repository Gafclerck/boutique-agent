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

## 4. Analyse et Observations (Mesures de Base)

1. **Impact du correctif de recherche multi-mots** :
   - Dans le Scénario 3, le mot-clé `"sac raphia"` renvoie désormais immédiatement le produit `P03` (`Sac en raphia` à 7 500 FCFA). L'erreur d'observation `aucun produit pour sac raphia` a totalement disparu.
2. **Identification des anomalies de base liées à `verifier_stock`** :
   - Dès qu'un client s'intéresse à un produit précis par son prix ou son type (Scénarios 3, a, c), le LLM actuel a tendance à répondre directement dès qu'il a le prix ou à demander des précisions sans appeler systématiquement `verifier_stock`.
   - Ces anomalies constituent la ligne de base quantitative avant d'évaluer l'impact des instructions.

---

## 5. Instructions v2 (règle de stock précisée)

Dans ce second volet (Prompt 1.3), une unique modification de code a été apportée à `src/agent/instructions.ts` en précisant calmement la règle de vérification et de gestion de rupture :
- *"Quand chercher_produits renvoie des produits dont tu parles dans ta réponse, appelle verifier_stock pour chacun avant de répondre, même si le client ne demande que le prix."*
- *"Si le stock est 0, annonce d'abord la rupture, puis propose une alternative dont le stock a été vérifié avec verifier_stock."*

### 5.1 Environnement de Remesure

- **Modèle LLM** : `anthropic/claude-haiku-4-5-20251001` (via API Rodium AI)
- **Température** : 0
- **Nombre d'essais** : 5 exécutions indépendantes par scénario via `npm run ask`
- **Date des mesures** : 1er novembre 2026

### 5.2 Tableau de Synthèse — Instructions v2

| Scénario | Requête client | Taux de réussite | Appels LLM (moy.) | Tokens (moy.) | Statut |
| :--- | :--- | :---: | :---: | :---: | :--- |
| **S1** | *"Vous avez des pagnes ? Combien ça fait en euros pour ma soeur à Paris ?"* | **5/5 (100 %)** | 3,0 | 8 170 | **OK** (aucune régression) |
| **S2** | *"Livrez-moi à Lomé."* | **5/5 (100 %)** | 2,0 | 5 157 | **OK** (aucune régression) |
| **S3** | *"C'est combien le sac en raphia ?"* | **0/5 (0 %)** | 3,0 | 7 903 | **ANOMALIE** (`verifier_stock` appelé sur P03, rupture annoncée, mais aucune alternative vérifiée dans le même tour) |
| **a** | *"Bonjour, vous avez des sacs ?"* | **0/5 (0 %)** | 1,0 | 2 490 | **ANOMALIE** (clarification demandée sans vérification de stock préalable) |
| **c** | *"Combien coûte une robe en dollars ?"* | **5/5 (100 %)** | 3,0 | 8 089 | **OK** (`verifier_stock` désormais systématiquement appelé avant conversion) |

---

### 5.3 Tableau Détaillé des 25 Essais (Instructions v2)

#### Scénario 1 (S1) : *"Vous avez des pagnes ? Combien ça fait en euros pour ma soeur à Paris ?"*

| Essai | Séquence d'outils appelés | Verdict | Appels LLM | Tokens cumulés | Détail de la réponse |
| :---: | :--- | :---: | :---: | :---: | :--- |
| 1 | `chercher_produits` → `verifier_stock` → `convertir_devise` | **OK** | 3 | 8 170 | Pagne wax en stock (14), 12 000 FCFA = 18,29 EUR |
| 2 | `chercher_produits` → `verifier_stock` → `convertir_devise` | **OK** | 3 | 8 170 | Pagne wax en stock (14), 12 000 FCFA = 18,29 EUR |
| 3 | `chercher_produits` → `verifier_stock` → `convertir_devise` | **OK** | 3 | 8 170 | Pagne wax en stock (14), 12 000 FCFA = 18,29 EUR |
| 4 | `chercher_produits` → `verifier_stock` → `convertir_devise` | **OK** | 3 | 8 170 | Pagne wax en stock (14), 12 000 FCFA = 18,29 EUR |
| 5 | `chercher_produits` → `verifier_stock` → `convertir_devise` | **OK** | 3 | 8 170 | Pagne wax en stock (14), 12 000 FCFA = 18,29 EUR |

#### Scénario 2 (S2) : *"Livrez-moi à Lomé."*

| Essai | Séquence d'outils appelés | Verdict | Appels LLM | Tokens cumulés | Détail de la réponse |
| :---: | :--- | :---: | :---: | :---: | :--- |
| 1 | `frais_livraison` | **OK** | 2 | 5 157 | Lomé non desservie, liste Cotonou, Akpakpa, Fidjrossè, Calavi, Porto-Novo, Ouidah |
| 2 | `frais_livraison` | **OK** | 2 | 5 157 | Lomé non desservie, liste Cotonou, Akpakpa, Fidjrossè, Calavi, Porto-Novo, Ouidah |
| 3 | `frais_livraison` | **OK** | 2 | 5 157 | Lomé non desservie, liste Cotonou, Akpakpa, Fidjrossè, Calavi, Porto-Novo, Ouidah |
| 4 | `frais_livraison` | **OK** | 2 | 5 157 | Lomé non desservie, liste Cotonou, Akpakpa, Fidjrossè, Calavi, Porto-Novo, Ouidah |
| 5 | `frais_livraison` | **OK** | 2 | 5 157 | Lomé non desservie, liste Cotonou, Akpakpa, Fidjrossè, Calavi, Porto-Novo, Ouidah |

#### Scénario 3 (S3) : *"C'est combien le sac en raphia ?"*

| Essai | Séquence d'outils appelés | Verdict | Alt. stock vérifié ? | Appels LLM | Tokens cumulés | Détail de la réponse |
| :---: | :--- | :---: | :---: | :---: | :---: | :--- |
| 1 | `chercher_produits` → `verifier_stock` | **ANOMALIE** | **non** | 3 | 7 903 | Rupture annoncée pour Sac en raphia ; demande à l'usager quel accessoire l'intéresse |
| 2 | `chercher_produits` → `verifier_stock` | **ANOMALIE** | **non** | 3 | 7 903 | Rupture annoncée pour Sac en raphia ; demande à l'usager quel accessoire l'intéresse |
| 3 | `chercher_produits` → `verifier_stock` | **ANOMALIE** | **non** | 3 | 7 903 | Rupture annoncée pour Sac en raphia ; demande à l'usager quel accessoire l'intéresse |
| 4 | `chercher_produits` → `verifier_stock` | **ANOMALIE** | **non** | 3 | 7 903 | Rupture annoncée pour Sac en raphia ; demande à l'usager quel accessoire l'intéresse |
| 5 | `chercher_produits` → `verifier_stock` | **ANOMALIE** | **non** | 3 | 7 903 | Rupture annoncée pour Sac en raphia ; demande à l'usager quel accessoire l'intéresse |

#### Scénario a : *"Bonjour, vous avez des sacs ?"*

| Essai | Séquence d'outils appelés | Verdict | Appels LLM | Tokens cumulés | Détail de la réponse |
| :---: | :--- | :---: | :---: | :---: | :--- |
| 1 | *(aucun)* | **ANOMALIE** | 1 | 2 490 | Demande de précisions sans appel préalable de `verifier_stock` |
| 2 | *(aucun)* | **ANOMALIE** | 1 | 2 490 | Demande de précisions sans appel préalable de `verifier_stock` |
| 3 | *(aucun)* | **ANOMALIE** | 1 | 2 490 | Demande de précisions sans appel préalable de `verifier_stock` |
| 4 | *(aucun)* | **ANOMALIE** | 1 | 2 490 | Demande de précisions sans appel préalable de `verifier_stock` |
| 5 | *(aucun)* | **ANOMALIE** | 1 | 2 490 | Demande de précisions sans appel préalable de `verifier_stock` |

#### Scénario c : *"Combien coûte une robe en dollars ?"*

| Essai | Séquence d'outils appelés | Verdict | Appels LLM | Tokens cumulés | Détail de la réponse |
| :---: | :--- | :---: | :---: | :---: | :--- |
| 1 | `chercher_produits` → `verifier_stock` → `convertir_devise` | **OK** | 3 | 8 089 | Robe en wax (22 000 FCFA = 37,44 USD), stock vérifié (5 disponibles) |
| 2 | `chercher_produits` → `verifier_stock` → `convertir_devise` | **OK** | 3 | 8 089 | Robe en wax (22 000 FCFA = 37,44 USD), stock vérifié (5 disponibles) |
| 3 | `chercher_produits` → `verifier_stock` → `convertir_devise` | **OK** | 3 | 8 089 | Robe en wax (22 000 FCFA = 37,44 USD), stock vérifié (5 disponibles) |
| 4 | `chercher_produits` → `verifier_stock` → `convertir_devise` | **OK** | 3 | 8 089 | Robe en wax (22 000 FCFA = 37,44 USD), stock vérifié (5 disponibles) |
| 5 | `chercher_produits` → `verifier_stock` → `convertir_devise` | **OK** | 3 | 8 089 | Robe en wax (22 000 FCFA = 37,44 USD), stock vérifié (5 disponibles) |

---

### 5.4 Tableau Comparatif Avant / Après

| Scénario | Réussite Baseline v1 | Réussite Instructions v2 | Évolution | Observation clé |
| :--- | :---: | :---: | :---: | :--- |
| **S1** (Pagne + EUR) | 5/5 (100 %) | 5/5 (100 %) | = (0) | Aucune régression ; chaîne de 3 outils toujours parfaite |
| **S2** (Lomé) | 5/5 (100 %) | 5/5 (100 %) | = (0) | Aucune régression ; détection immédiate de zone non desservie |
| **S3** (Sac raphia) | 0/5 (0 %) | 0/5 (0 %) | = (0)* | *Progrès partiel : `verifier_stock` est désormais appelé et la rupture est annoncée, mais le modèle demande confirmation avant de chercher une alternative |
| **a** (Avez-vous des sacs ?) | 0/5 (0 %) | 0/5 (0 %) | = (0) | Stagnation : le modèle privilégie la clarification conversationnelle |
| **c** (Robe en USD) | 0/5 (0 %) | **5/5 (100 %)** | **+100 %** | **Succès complet** : la précision "même si le client ne demande que le prix" a résolu l'oubli de `verifier_stock` |

---

### 5.5 Conclusion et Décision sur le Tag Git `palier-1`

- **Condition de taggage requise** : S3, a et c doivent chacun atteindre au moins 4/5, et S1 et S2 ne doivent pas régresser.
- **Résultat effectif** :
  - S1 : 5/5 (OK)
  - S2 : 5/5 (OK)
  - c : 5/5 (OK)
  - **S3 : 0/5 (ÉCHEC)**
  - **a : 0/5 (ÉCHEC)**
- **Décision** : Le tag `palier-1` **n'est pas créé**. Le tag `palier-1-baseline` reste positionné sur le commit de base initial `86d4415`.
- **Explication** : Une simple consigne textuelle dans le prompt système permet de corriger des cas ciblés comme `c` (prix explicite d'un article disponible), mais reste insuffisante face à des comportements conversationnels réflexes (poser une question ouverte en `a` au lieu d'explorer le catalogue, ou demander la permission en `S3` avant de chercher une alternative). Ce résultat valide l'utilité du Palier 2a pour structurer davantage la boucle d'agent et les politiques d'outils.
