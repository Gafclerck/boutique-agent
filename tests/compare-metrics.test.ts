import { describe, expect, it } from 'vitest';
import {
  buildSubjectTableData,
  renderReport,
  type RunRecord,
  subjectTable,
  summarizeCells,
} from '../src/metrics/compare.js';

describe('Métriques de comparaison et fonctions pures (src/metrics/compare.ts)', () => {
  const sampleRecords: RunRecord[] = [
    // S1 - single (3 runs, all ok)
    {
      scenario: 'S1',
      mode: 'single',
      run: 1,
      ok: true,
      reasons: [],
      stopReason: 'answered',
      llmCalls: 4,
      promptTokens: 1000,
      completionTokens: 200,
      durationMs: 1200,
      evaluationRetries: 0,
      judgeErrors: 0,
      toolNames: ['chercher_produits', 'convertir_devise'],
      replyExcerpt: 'Voici le prix en euros.',
    },
    {
      scenario: 'S1',
      mode: 'single',
      run: 2,
      ok: true,
      reasons: [],
      stopReason: 'answered',
      llmCalls: 4,
      promptTokens: 1100,
      completionTokens: 220,
      durationMs: 1300,
      evaluationRetries: 0,
      judgeErrors: 0,
      toolNames: ['chercher_produits', 'convertir_devise'],
      replyExcerpt: 'Voici le prix en euros.',
    },
    {
      scenario: 'S1',
      mode: 'single',
      run: 3,
      ok: true,
      reasons: [],
      stopReason: 'answered',
      llmCalls: 4,
      promptTokens: 900,
      completionTokens: 180,
      durationMs: 1100,
      evaluationRetries: 0,
      judgeErrors: 0,
      toolNames: ['chercher_produits', 'convertir_devise'],
      replyExcerpt: 'Voici le prix en euros.',
    },

    // S1 - team (3 runs, all ok)
    {
      scenario: 'S1',
      mode: 'team',
      run: 1,
      ok: true,
      reasons: [],
      stopReason: 'answered',
      llmCalls: 8,
      promptTokens: 2500,
      completionTokens: 400,
      durationMs: 3000,
      evaluationRetries: 0,
      judgeErrors: 0,
      toolNames: ['demander_au_vendeur', 'demander_au_logisticien'],
      replyExcerpt: 'En euros cela fait 18,29 €.',
    },
    {
      scenario: 'S1',
      mode: 'team',
      run: 2,
      ok: true,
      reasons: [],
      stopReason: 'answered',
      llmCalls: 8,
      promptTokens: 2600,
      completionTokens: 420,
      durationMs: 3100,
      evaluationRetries: 0,
      judgeErrors: 0,
      toolNames: ['demander_au_vendeur', 'demander_au_logisticien'],
      replyExcerpt: 'En euros cela fait 18,29 €.',
    },
    {
      scenario: 'S1',
      mode: 'team',
      run: 3,
      ok: true,
      reasons: [],
      stopReason: 'answered',
      llmCalls: 8,
      promptTokens: 2400,
      completionTokens: 380,
      durationMs: 2900,
      evaluationRetries: 0,
      judgeErrors: 0,
      toolNames: ['demander_au_vendeur', 'demander_au_logisticien'],
      replyExcerpt: 'En euros cela fait 18,29 €.',
    },

    // S2 - single (3 runs, 2 ok, 1 failed with fallback)
    {
      scenario: 'S2',
      mode: 'single',
      run: 1,
      ok: true,
      reasons: [],
      stopReason: 'answered',
      llmCalls: 3,
      promptTokens: 800,
      completionTokens: 100,
      durationMs: 900,
      evaluationRetries: 0,
      judgeErrors: 0,
      toolNames: ['frais_livraison'],
      replyExcerpt: 'Lomé n\'est pas desservie.',
    },
    {
      scenario: 'S2',
      mode: 'single',
      run: 2,
      ok: false,
      reasons: ['frais_livraison n\'a pas été appelé'],
      stopReason: 'evaluation_failed',
      llmCalls: 5,
      promptTokens: 1500,
      completionTokens: 150,
      durationMs: 1600,
      evaluationRetries: 2,
      judgeErrors: 0,
      toolNames: [],
      replyExcerpt: 'Désolé, message de repli.',
    },
    {
      scenario: 'S2',
      mode: 'single',
      run: 3,
      ok: true,
      reasons: [],
      stopReason: 'answered',
      llmCalls: 3,
      promptTokens: 850,
      completionTokens: 110,
      durationMs: 950,
      evaluationRetries: 0,
      judgeErrors: 0,
      toolNames: ['frais_livraison'],
      replyExcerpt: 'Lomé n\'est pas desservie.',
    },

    // S2 - team (3 runs, all ok)
    {
      scenario: 'S2',
      mode: 'team',
      run: 1,
      ok: true,
      reasons: [],
      stopReason: 'answered',
      llmCalls: 6,
      promptTokens: 1800,
      completionTokens: 300,
      durationMs: 2200,
      evaluationRetries: 0,
      judgeErrors: 0,
      toolNames: ['demander_au_logisticien'],
      replyExcerpt: 'Lomé n\'est pas desservie.',
    },
    {
      scenario: 'S2',
      mode: 'team',
      run: 2,
      ok: true,
      reasons: [],
      stopReason: 'answered',
      llmCalls: 6,
      promptTokens: 1900,
      completionTokens: 320,
      durationMs: 2300,
      evaluationRetries: 0,
      judgeErrors: 0,
      toolNames: ['demander_au_logisticien'],
      replyExcerpt: 'Lomé n\'est pas desservie.',
    },
    {
      scenario: 'S2',
      mode: 'team',
      run: 3,
      ok: true,
      reasons: [],
      stopReason: 'answered',
      llmCalls: 6,
      promptTokens: 1700,
      completionTokens: 280,
      durationMs: 2100,
      evaluationRetries: 0,
      judgeErrors: 0,
      toolNames: ['demander_au_logisticien'],
      replyExcerpt: 'Lomé n\'est pas desservie.',
    },

    // S3 - single (3 runs, all ok)
    {
      scenario: 'S3',
      mode: 'single',
      run: 1,
      ok: true,
      reasons: [],
      stopReason: 'answered',
      llmCalls: 4,
      promptTokens: 1200,
      completionTokens: 150,
      durationMs: 1400,
      evaluationRetries: 0,
      judgeErrors: 0,
      toolNames: ['verifier_stock', 'verifier_stock'],
      replyExcerpt: 'Sac en raphia en rupture, sandales en cuir disponibles.',
    },
    {
      scenario: 'S3',
      mode: 'single',
      run: 2,
      ok: true,
      reasons: [],
      stopReason: 'answered',
      llmCalls: 4,
      promptTokens: 1250,
      completionTokens: 160,
      durationMs: 1450,
      evaluationRetries: 0,
      judgeErrors: 0,
      toolNames: ['verifier_stock', 'verifier_stock'],
      replyExcerpt: 'Sac en raphia en rupture, sandales en cuir disponibles.',
    },
    {
      scenario: 'S3',
      mode: 'single',
      run: 3,
      ok: true,
      reasons: [],
      stopReason: 'answered',
      llmCalls: 4,
      promptTokens: 1150,
      completionTokens: 140,
      durationMs: 1350,
      evaluationRetries: 0,
      judgeErrors: 0,
      toolNames: ['verifier_stock', 'verifier_stock'],
      replyExcerpt: 'Sac en raphia en rupture, sandales en cuir disponibles.',
    },

    // S3 - team (3 runs, all ok)
    {
      scenario: 'S3',
      mode: 'team',
      run: 1,
      ok: true,
      reasons: [],
      stopReason: 'answered',
      llmCalls: 7,
      promptTokens: 2100,
      completionTokens: 350,
      durationMs: 2700,
      evaluationRetries: 0,
      judgeErrors: 0,
      toolNames: ['demander_au_vendeur'],
      replyExcerpt: 'Sac en raphia en rupture, alternative sandales.',
    },
    {
      scenario: 'S3',
      mode: 'team',
      run: 2,
      ok: true,
      reasons: [],
      stopReason: 'answered',
      llmCalls: 7,
      promptTokens: 2150,
      completionTokens: 360,
      durationMs: 2750,
      evaluationRetries: 0,
      judgeErrors: 0,
      toolNames: ['demander_au_vendeur'],
      replyExcerpt: 'Sac en raphia en rupture, alternative sandales.',
    },
    {
      scenario: 'S3',
      mode: 'team',
      run: 3,
      ok: true,
      reasons: [],
      stopReason: 'answered',
      llmCalls: 7,
      promptTokens: 2050,
      completionTokens: 340,
      durationMs: 2650,
      evaluationRetries: 0,
      judgeErrors: 0,
      toolNames: ['demander_au_vendeur'],
      replyExcerpt: 'Sac en raphia en rupture, alternative sandales.',
    },

    // K - single (1 run, ok, hors tableau du sujet)
    {
      scenario: 'K',
      mode: 'single',
      run: 1,
      ok: true,
      reasons: [],
      stopReason: 'answered',
      llmCalls: 5,
      promptTokens: 1400,
      completionTokens: 200,
      durationMs: 1800,
      evaluationRetries: 0,
      judgeErrors: 0,
      toolNames: ['chercher_produits', 'verifier_stock', 'calculer_total', 'convertir_devise'],
      replyExcerpt: '3 pots de beurre de karité font 13 500 FCFA soit 33 750 NGN.',
    },
    // K - team (1 run, ok, hors tableau du sujet)
    {
      scenario: 'K',
      mode: 'team',
      run: 1,
      ok: true,
      reasons: [],
      stopReason: 'answered',
      llmCalls: 11,
      promptTokens: 3500,
      completionTokens: 600,
      durationMs: 4500,
      evaluationRetries: 0,
      judgeErrors: 0,
      toolNames: ['demander_au_vendeur', 'demander_au_logisticien', 'demander_au_redacteur'],
      replyExcerpt: '3 pots de beurre de karité font 13 500 FCFA soit 33 750 NGN.',
    },
  ];

  describe('summarizeCells()', () => {
    it('agrège correctement les métriques pour chaque couple (scénario, mode)', () => {
      const summaries = summarizeCells(sampleRecords, 'google/gemini-2.5-flash');

      // 4 scénarios x 2 modes = 8 cellules
      expect(summaries).toHaveLength(8);

      const s1Single = summaries.find((s) => s.scenario === 'S1' && s.mode === 'single');
      expect(s1Single).toBeDefined();
      expect(s1Single?.runs).toBe(3);
      expect(s1Single?.successes).toBe(3);
      expect(s1Single?.allSuccessful).toBe(true);
      expect(s1Single?.avgLlmCalls).toBe(4);
      expect(s1Single?.avgDurationMs).toBe(1200);
      expect(s1Single?.avgPromptTokens).toBe(1000);
      expect(s1Single?.avgCompletionTokens).toBe(200);
      expect(s1Single?.avgCostRodi).toBeGreaterThan(0);
      expect(s1Single?.costFormatted).toContain('RODI');
      expect(s1Single?.avgRetries).toBe(0);
      expect(s1Single?.fallbackCount).toBe(0);

      const s2Single = summaries.find((s) => s.scenario === 'S2' && s.mode === 'single');
      expect(s2Single).toBeDefined();
      expect(s2Single?.runs).toBe(3);
      expect(s2Single?.successes).toBe(2);
      expect(s2Single?.allSuccessful).toBe(false);
      expect(s2Single?.fallbackCount).toBe(1);
      expect(s2Single?.avgRetries).toBeCloseTo(2 / 3);
    });

    it('renvoie coût "non disponible" si le modèle est inconnu (jamais deviné)', () => {
      const summaries = summarizeCells(sampleRecords, 'modele-totalement-inconnu');
      for (const s of summaries) {
        expect(s.avgCostRodi).toBeNull();
        expect(s.costFormatted).toBe('non disponible');
      }
    });
  });

  describe('subjectTable()', () => {
    it('calcule les valeurs sur S1, S2, S3 uniquement (K est exclu)', () => {
      const data = buildSubjectTableData(sampleRecords, 'google/gemini-2.5-flash');

      // Single: S1 (3/3 ok), S2 (2/3 ok -> pas all successful), S3 (3/3 ok) -> 2 scénarios pleinement réussis sur 3
      expect(data.single.correctScenariosCount).toBe(2);
      expect(data.single.correctScenariosText).toBe('2/3 (8/9 - 88.9 %)');

      // Team: S1 (3/3 ok), S2 (3/3 ok), S3 (3/3 ok) -> 3/3 pleinement réussis
      expect(data.team.correctScenariosCount).toBe(3);
      expect(data.team.correctScenariosText).toBe('3/3 (9/9 - 100.0 %)');

      // Calls: Single S1(4)+S2(11/3)+S3(4) -> (4*3 + 11 + 4*3) / 9 = 35 / 9 = 3.88
      expect(data.single.avgLlmCalls).toBeCloseTo(35 / 9);

      // Markdown table string
      const tableMd = subjectTable(sampleRecords, 'google/gemini-2.5-flash');
      expect(tableMd).toContain('| Métrique | Agent seul | Multi-agents |');
      expect(tableMd).toContain('Réponses correctes (/3)');
      expect(tableMd).toContain('2/3 (8/9 - 88.9 %)');
      expect(tableMd).toContain('3/3 (9/9 - 100.0 %)');
      expect(tableMd).toContain('Nombre d\'appels LLM');
      expect(tableMd).toContain('Temps de réponse moyen');
      expect(tableMd).toContain('Coût estimé (RODI)');
    });

    it('gère les cellules incomplètes ou vides sans planter', () => {
      const data = buildSubjectTableData([], 'google/gemini-2.5-flash');
      expect(data.single.correctScenariosCount).toBe(0);
      expect(data.single.correctScenariosText).toBe('0/3 (0/0 - 0.0 %)');
      expect(data.single.avgLlmCalls).toBe(0);
      expect(data.single.avgDurationMs).toBe(0);

      const tableMd = subjectTable([], 'modele-inconnu');
      expect(tableMd).toContain('0/3 (0/0 - 0.0 %)');
      expect(tableMd).toContain('non disponible');
    });
  });

  describe('renderReport()', () => {
    it('produit le Markdown conforme avec en-tête, limites et conclusion VIDE', () => {
      const report = renderReport(sampleRecords, {
        date: '2026-11-04',
        model: 'google/gemini-2.5-flash',
        runsPerScenario: 3,
        scenarios: ['S1', 'S2', 'S3', 'K'],
        judgeEnabled: false,
        maxTurnLlmCalls: 20,
        maxGlobalLlmCalls: 150,
        totalCallsConsumed: 60,
      });

      // En-tête
      expect(report).toContain('google/gemini-2.5-flash');
      expect(report).toContain('2026-11-04');
      expect(report).toContain('Source : GET /v1/pricing');
      expect(report).toContain('S1, S2, S3, K');
      expect(report).toContain('60 réellement consommés');
      expect(report).toContain('150');

      // Tableau du sujet
      expect(report).toContain('## 2. Tableau comparatif du sujet (Scénarios S1, S2, S3)');
      expect(report).toContain('Réponses correctes (/3)');

      // Tableau détaillé avec K
      expect(report).toContain('## 3. Résultats détaillés par scénario et par mode');
      expect(report).toContain('| K | Agent seul |');
      expect(report).toContain('| K | Équipe |');

      // Journal non conforme
      expect(report).toContain('## 4. Journal des exécutions non conformes');
      expect(report).toContain('[S2] Agent seul — Essai #2');
      expect(report).toContain('frais_livraison n\'a pas été appelé');

      // Limites
      expect(report).toContain('## 5. Limites méthodologiques');
      expect(report).toContain('Échantillon réduit');
      expect(report).toContain('Règle des trois (Rule of Three)');
      expect(report).toContain('Monoculture du modèle');
      expect(report).toContain('Latence réseau fluctuante');
      expect(report).toContain('Modélisation linéaire des coûts');

      // Conclusion STRICTEMENT VIDE
      expect(report).toContain('## Conclusion (à rédiger par l\'étudiant, deux phrases)');
      expect(report).toContain('95 % par étape sur 10 étapes = 60 % de bout en bout');

      // Vérifie que nous n'avons rédigé aucune conclusion
      const afterConclusion = report.split('## Conclusion (à rédiger par l\'étudiant, deux phrases)')[1] ?? '';
      // Elle ne contient que le commentaire de rappel
      const nonCommentLines = afterConclusion
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => l.length > 0 && !l.startsWith('<!--') && !l.endsWith('-->'));
      expect(nonCommentLines).toEqual([]);
    });
  });
});
