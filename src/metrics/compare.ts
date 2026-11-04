import { estimateCostRodi } from './cost.js';
import { getModelPrice, type ModelPrice } from './model-prices.js';

export interface RunRecord {
  readonly scenario: string;
  readonly mode: 'single' | 'team';
  readonly run: number;
  readonly ok: boolean;
  readonly reasons: readonly string[];
  readonly stopReason: string;
  readonly llmCalls: number;
  readonly promptTokens: number;
  readonly completionTokens: number;
  readonly durationMs: number;
  readonly evaluationRetries: number;
  readonly judgeErrors: number;
  readonly toolNames: readonly string[];
  readonly replyExcerpt: string;
  readonly error?: string;
}

export interface CellSummary {
  readonly scenario: string;
  readonly mode: 'single' | 'team';
  readonly runs: number;
  readonly successes: number;
  readonly successRate: number;
  readonly allSuccessful: boolean;
  readonly avgLlmCalls: number;
  readonly avgDurationMs: number;
  readonly avgPromptTokens: number;
  readonly avgCompletionTokens: number;
  readonly avgCostRodi: number | null;
  readonly costFormatted: string;
  readonly avgRetries: number;
  readonly fallbackCount: number;
}

export interface SubjectTableColumn {
  readonly correctScenariosCount: number; // e.g. 3 out of 3
  readonly correctScenariosText: string; // e.g. "3/3 (9/9 - 100.0 %)"
  readonly avgLlmCalls: number;
  readonly avgDurationMs: number;
  readonly avgCostRodi: number | null;
  readonly costFormatted: string;
}

export interface SubjectTableData {
  readonly single: SubjectTableColumn;
  readonly team: SubjectTableColumn;
}

export interface CompareReportMetadata {
  readonly date: string;
  readonly model: string;
  readonly runsPerScenario: number;
  readonly scenarios: readonly string[];
  readonly judgeEnabled: boolean;
  readonly maxTurnLlmCalls: number;
  readonly maxGlobalLlmCalls: number;
  readonly totalCallsConsumed: number;
}

/**
 * Agrège les enregistrements bruts par scénario et par mode (fonctions pures).
 */
export function summarizeCells(
  records: readonly RunRecord[],
  modelId: string,
): readonly CellSummary[] {
  const price = getModelPrice(modelId);

  // Regroupement par clé "scenario|mode"
  const groups = new Map<string, RunRecord[]>();
  for (const record of records) {
    const key = `${record.scenario}|${record.mode}`;
    const list = groups.get(key);
    if (list) {
      list.push(record);
    } else {
      groups.set(key, [record]);
    }
  }

  const summaries: CellSummary[] = [];

  for (const group of groups.values()) {
    const first = group[0];
    if (!first) continue;

    const scenario = first.scenario;
    const mode = first.mode;
    const runs = group.length;

    const successes = group.filter((r) => r.ok).length;
    const successRate = runs > 0 ? successes / runs : 0;
    const allSuccessful = runs > 0 && successes === runs;

    const sumCalls = group.reduce((sum, r) => sum + r.llmCalls, 0);
    const sumDuration = group.reduce((sum, r) => sum + r.durationMs, 0);
    const sumPromptTokens = group.reduce((sum, r) => sum + r.promptTokens, 0);
    const sumCompletionTokens = group.reduce((sum, r) => sum + r.completionTokens, 0);
    const sumRetries = group.reduce((sum, r) => sum + r.evaluationRetries, 0);
    const fallbackCount = group.filter((r) => r.stopReason !== 'answered').length;

    const avgLlmCalls = runs > 0 ? sumCalls / runs : 0;
    const avgDurationMs = runs > 0 ? sumDuration / runs : 0;
    const avgPromptTokens = runs > 0 ? sumPromptTokens / runs : 0;
    const avgCompletionTokens = runs > 0 ? sumCompletionTokens / runs : 0;
    const avgRetries = runs > 0 ? sumRetries / runs : 0;

    let avgCostRodi: number | null = null;
    let costFormatted = 'non disponible';

    if (price) {
      const estimate = estimateCostRodi(
        {
          promptTokens: Math.round(avgPromptTokens),
          completionTokens: Math.round(avgCompletionTokens),
          totalTokens: Math.round(avgPromptTokens + avgCompletionTokens),
        },
        price,
      );
      avgCostRodi = estimate.totalRodi;
      costFormatted = `${avgCostRodi.toFixed(4)} RODI`;
    }

    summaries.push({
      scenario,
      mode,
      runs,
      successes,
      successRate,
      allSuccessful,
      avgLlmCalls,
      avgDurationMs,
      avgPromptTokens,
      avgCompletionTokens,
      avgCostRodi,
      costFormatted,
      avgRetries,
      fallbackCount,
    });
  }

  // Tri déterministe : scénarios dans l'ordre, puis single avant team
  summaries.sort((a, b) => {
    if (a.scenario !== b.scenario) {
      return a.scenario.localeCompare(b.scenario);
    }
    if (a.mode === b.mode) return 0;
    return a.mode === 'single' ? -1 : 1;
  });

  return summaries;
}

/**
 * Calcule la colonne du tableau du sujet pour un mode donné sur S1, S2, S3 uniquement.
 */
function computeModeSubjectColumn(
  records: readonly RunRecord[],
  mode: 'single' | 'team',
  price?: ModelPrice,
): SubjectTableColumn {
  const targetScenarios = ['S1', 'S2', 'S3'] as const;
  const filtered = records.filter(
    (r) => r.mode === mode && targetScenarios.includes(r.scenario as (typeof targetScenarios)[number]),
  );

  let fullySuccessfulScenarios = 0;
  for (const sId of targetScenarios) {
    const sRuns = filtered.filter((r) => r.scenario === sId);
    if (sRuns.length > 0 && sRuns.every((r) => r.ok)) {
      fullySuccessfulScenarios++;
    }
  }

  const totalRuns = filtered.length;
  const totalSuccesses = filtered.filter((r) => r.ok).length;
  const detailedRate =
    totalRuns > 0 ? ((totalSuccesses / totalRuns) * 100).toFixed(1) : '0.0';

  const correctScenariosText = `${fullySuccessfulScenarios}/3 (${totalSuccesses}/${totalRuns} - ${detailedRate} %)`;

  const sumCalls = filtered.reduce((sum, r) => sum + r.llmCalls, 0);
  const sumDuration = filtered.reduce((sum, r) => sum + r.durationMs, 0);
  const sumPromptTokens = filtered.reduce((sum, r) => sum + r.promptTokens, 0);
  const sumCompletionTokens = filtered.reduce((sum, r) => sum + r.completionTokens, 0);

  const avgLlmCalls = totalRuns > 0 ? sumCalls / totalRuns : 0;
  const avgDurationMs = totalRuns > 0 ? sumDuration / totalRuns : 0;
  const avgPrompt = totalRuns > 0 ? sumPromptTokens / totalRuns : 0;
  const avgCompletion = totalRuns > 0 ? sumCompletionTokens / totalRuns : 0;

  let avgCostRodi: number | null = null;
  let costFormatted = 'non disponible';

  if (price) {
    const estimate = estimateCostRodi(
      {
        promptTokens: Math.round(avgPrompt),
        completionTokens: Math.round(avgCompletion),
        totalTokens: Math.round(avgPrompt + avgCompletion),
      },
      price,
    );
    avgCostRodi = estimate.totalRodi;
    costFormatted = `${avgCostRodi.toFixed(4)} RODI`;
  }

  return {
    correctScenariosCount: fullySuccessfulScenarios,
    correctScenariosText,
    avgLlmCalls,
    avgDurationMs,
    avgCostRodi,
    costFormatted,
  };
}

/**
 * Produit les données calculées du tableau du sujet sur S1, S2, S3 uniquement.
 */
export function buildSubjectTableData(
  records: readonly RunRecord[],
  modelId: string,
): SubjectTableData {
  const price = getModelPrice(modelId);
  return {
    single: computeModeSubjectColumn(records, 'single', price),
    team: computeModeSubjectColumn(records, 'team', price),
  };
}

/**
 * Génère le Markdown du tableau du sujet (S1, S2, S3 uniquement).
 */
export function subjectTable(
  records: readonly RunRecord[],
  modelId: string,
): string {
  const data = buildSubjectTableData(records, modelId);

  const formatCalls = (val: number) => val.toFixed(1);
  const formatTime = (ms: number) =>
    ms >= 1000 ? `${(ms / 1000).toFixed(2)} s` : `${Math.round(ms)} ms`;

  return [
    '| Métrique | Agent seul | Multi-agents |',
    '|---|---|---|',
    `| Réponses correctes (/3) | ${data.single.correctScenariosText} | ${data.team.correctScenariosText} |`,
    `| Nombre d'appels LLM | ${formatCalls(data.single.avgLlmCalls)} | ${formatCalls(data.team.avgLlmCalls)} |`,
    `| Temps de réponse moyen | ${formatTime(data.single.avgDurationMs)} | ${formatTime(data.team.avgDurationMs)} |`,
    `| Coût estimé (RODI) | ${data.single.costFormatted} | ${data.team.costFormatted} |`,
  ].join('\n');
}

/**
 * Génère le tableau détaillé incluant K en ligne supplémentaire hors tableau du sujet.
 */
export function renderDetailedTable(
  summaries: readonly CellSummary[],
): string {
  const formatCalls = (val: number) => val.toFixed(1);
  const formatTime = (ms: number) =>
    ms >= 1000 ? `${(ms / 1000).toFixed(2)} s` : `${Math.round(ms)} ms`;
  const formatTokens = (val: number) => Math.round(val).toLocaleString('fr-FR');
  const formatRetries = (val: number) => val.toFixed(2);

  const lines = [
    '| Scénario | Mode | Exécutions | Réussites | Appels moy. | Durée moy. | Tokens entrée | Tokens sortie | Coût estimé | Reprises | Replis |',
    '|---|---|---|---|---|---|---|---|---|---|---|',
  ];

  for (const s of summaries) {
    const modeLabel = s.mode === 'single' ? 'Agent seul' : 'Équipe';
    const successLabel = `${s.successes}/${s.runs} (${(s.successRate * 100).toFixed(0)} %)`;
    lines.push(
      `| ${s.scenario} | ${modeLabel} | ${s.runs} | ${successLabel} | ${formatCalls(s.avgLlmCalls)} | ${formatTime(s.avgDurationMs)} | ${formatTokens(s.avgPromptTokens)} | ${formatTokens(s.avgCompletionTokens)} | ${s.costFormatted} | ${formatRetries(s.avgRetries)} | ${s.fallbackCount} |`,
    );
  }

  return lines.join('\n');
}

/**
 * Génère la liste des exécutions non conformes.
 */
export function renderNonConformingRuns(records: readonly RunRecord[]): string {
  const nonConforming = records.filter((r) => !r.ok || r.error);

  if (nonConforming.length === 0) {
    return 'Aucune exécution non conforme constatée (100 % de conformité).';
  }

  const lines: string[] = [];
  for (const r of nonConforming) {
    const modeLabel = r.mode === 'single' ? 'Agent seul' : 'Équipe';
    lines.push(`### [${r.scenario}] ${modeLabel} — Essai #${r.run}`);
    lines.push(`- **Statut / StopReason** : \`${r.stopReason}\``);

    if (r.reasons.length > 0) {
      lines.push('- **Raisons de non-conformité** :');
      for (const reason of r.reasons) {
        lines.push(`  - ${reason}`);
      }
    } else {
      lines.push('- **Raisons de non-conformité** : non spécifiée');
    }

    const seq = r.toolNames.length > 0 ? r.toolNames.join(' → ') : '(aucun outil)';
    lines.push(`- **Séquence d'outils** : \`${seq}\``);
    lines.push(`- **Extrait de réponse** : *"${r.replyExcerpt || '(vide)'}"*`);

    if (r.error) {
      lines.push(`- **Erreur consignée** : \`${r.error}\``);
    }

    lines.push('');
  }

  return lines.join('\n').trimEnd();
}

/**
 * Génère le rapport Markdown complet conformément au cahier des charges.
 */
export function renderReport(
  records: readonly RunRecord[],
  meta: CompareReportMetadata,
): string {
  const price = getModelPrice(meta.model);
  const summaries = summarizeCells(records, meta.model);

  const priceDescription = price
    ? `${price.inputPerMillion} RODI/M tokens entrée, ${price.outputPerMillion} RODI/M tokens sortie (Source : GET /v1/pricing, novembre 2026)`
    : 'non disponible (modèle inconnu, aucun tarif deviné)';

  const judgeLabel = meta.judgeEnabled ? 'on (avec juge LLM)' : 'off';

  const sections: string[] = [];

  // 1. Titre & En-tête
  sections.push('# Comparaison des modes d\'exécution : Agent seul vs Équipe multi-agents\n');
  sections.push('## 1. Contexte et paramètres d\'exécution\n');
  sections.push(`- **Date** : ${meta.date}`);
  sections.push(`- **Modèle cible** : \`${meta.model}\``);
  sections.push(`- **Tarif** : ${priceDescription}`);
  sections.push(`- **Scénarios évalués** : ${meta.scenarios.join(', ')}`);
  sections.push(`- **Exécutions par scénario** : ${meta.runsPerScenario}`);
  sections.push(`- **Juge LLM (\`JUDGE\`)** : ${judgeLabel}`);
  sections.push(`- **Budget par tour (\`MAX_TOTAL_LLM_CALLS\`)** : ${meta.maxTurnLlmCalls}`);
  sections.push(
    `- **Plafond global d'appels** : ${meta.maxGlobalLlmCalls} (${meta.totalCallsConsumed} réellement consommés)`,
  );

  // 2. Tableau du sujet (S1, S2, S3 uniquement)
  sections.push('\n---\n');
  sections.push('## 2. Tableau comparatif du sujet (Scénarios S1, S2, S3)\n');
  sections.push(subjectTable(records, meta.model));

  // 3. Tableau détaillé par scénario et mode (avec K hors sujet)
  sections.push('\n---\n');
  sections.push('## 3. Résultats détaillés par scénario et par mode\n');
  sections.push(
    '> *Note : Le scénario K (Koffi) est affiché ici en ligne supplémentaire à titre d\'observation approfondie, hors tableau officiel du sujet.*\n',
  );
  sections.push(renderDetailedTable(summaries));

  // 4. Liste des exécutions non conformes
  sections.push('\n---\n');
  sections.push('## 4. Journal des exécutions non conformes\n');
  sections.push(renderNonConformingRuns(records));

  // 5. Section Limites générée
  sections.push('\n---\n');
  sections.push('## 5. Limites méthodologiques\n');
  sections.push(
    '- **Échantillon réduit** : 3 exécutions par scénario permettent de détecter les ruptures fonctionnelles manifestes, mais restent insuffisantes pour une analyse statistique à haute variance.',
  );
  sections.push(
    '- **Règle des trois (Rule of Three)** : si un événement indésirable apparaît 0 fois sur 3 essais, la borne supérieure de l\'intervalle de confiance à 95 % reste de 3/n (soit jusqu\'à 33 % de risque d\'anomalie résiduelle sur une population étendue).',
  );
  sections.push(
    '- **Monoculture du modèle** : les résultats observés reflètent le comportement spécifique du modèle testé et ne sauraient être généralisés sans réserve à d\'autres familles architecturales.',
  );
  sections.push(
    '- **Latence réseau fluctuante** : le temps de réponse total incorpore la gigue et la latence du réseau public ainsi que les fluctuations de charge de l\'API distante.',
  );
  sections.push(
    '- **Modélisation linéaire des coûts** : le calcul financier repose strictement sur la multiplication des tokens consommés par le tarif unitaire officiel (GET /v1/pricing), sans considérer de remise sur volume ni de coût fixe d\'infrastructure.',
  );

  // 6. Section Conclusion VIDE
  sections.push('\n---\n');
  sections.push('## Conclusion (à rédiger par l\'étudiant, deux phrases)\n');
  sections.push('<!-- Rappel : 95 % par étape sur 10 étapes = 60 % de bout en bout -->');

  return sections.join('\n');
}
