import { describe, expect, it } from 'vitest';
import { FakeLlm } from '../src/adapters/llm/fake-llm.js';
import { createSpecialistTool } from '../src/agent/team/specialist-tool.js';
import { ToolRegistry } from '../src/tools/registry.js';
import type { Tool } from '../src/tools/types.js';

describe('TACHE B : Outil spécialiste createSpecialistTool', () => {
  it('valide le paramètre texte unique requis (demande par défaut)', async () => {
    const fakeLlm = new FakeLlm([]);
    const specialist = createSpecialistTool({
      name: 'demander_au_vendeur',
      description: 'Délègue au vendeur',
      role: 'vendeur',
      instructions: 'Tu es le vendeur.',
      tools: new ToolRegistry(),
      llm: fakeLlm,
    });

    // Paramètre absent
    const resMissing = await specialist.execute({});
    expect(resMissing.erreur).toBe('argument invalide');

    // Paramètre non textuel
    const resNonString = await specialist.execute({ demande: 123 });
    expect(resNonString.erreur).toBe('argument invalide');

    // Paramètre vide
    const resEmpty = await specialist.execute({ demande: '   ' });
    expect(resEmpty.erreur).toBe('argument invalide');
  });

  it('valide le paramètre personnalisé (ex : faits pour le rédacteur)', async () => {
    const fakeLlm = new FakeLlm([]);
    const specialist = createSpecialistTool({
      name: 'demander_au_redacteur',
      description: 'Délègue au rédacteur',
      role: 'redacteur',
      instructions: 'Tu es le rédacteur.',
      tools: new ToolRegistry(),
      llm: fakeLlm,
      paramName: 'faits',
    });

    const resEmpty = await specialist.execute({ faits: '' });
    expect(resEmpty.erreur).toBe('argument invalide');

    const resWrongProp = await specialist.execute({ demande: 'quelque chose' });
    expect(resWrongProp.erreur).toBe('argument invalide');
  });

  it('executeDetailed renvoie { resume: ... } si answered et transmet les métriques imbriquées', async () => {
    const fakeLlm = new FakeLlm([
      {
        message: {
          role: 'assistant',
          content: 'Pagne wax disponible en stock.',
        },
        usage: { promptTokens: 30, completionTokens: 10 },
        model: 'fake',
      },
    ]);

    const specialist = createSpecialistTool({
      name: 'demander_au_vendeur',
      description: 'Délègue au vendeur',
      role: 'vendeur',
      instructions: 'Tu es le vendeur.',
      tools: new ToolRegistry(),
      llm: fakeLlm,
    });

    const detailed = await specialist.executeDetailed!({ demande: 'Vérifie le pagne' });
    expect(detailed.result).toEqual({ resume: 'Pagne wax disponible en stock.' });
    expect(detailed.nested).toBeDefined();
    expect(detailed.nested?.llmCalls).toBe(1);
    expect(detailed.nested?.usage.promptTokens).toBe(30);
    expect(detailed.nested?.traceEvents.length).toBeGreaterThan(0);
    expect(detailed.nested?.traceEvents[0]?.agent).toBe('vendeur');
  });

  it('executeDetailed renvoie une observation d\'erreur explicite en cas d\'échec du spécialiste', async () => {
    // LLM renvoie un contenu vide -> stopReason = empty_reply
    const fakeLlm = new FakeLlm([
      {
        message: {
          role: 'assistant',
          content: '',
        },
        usage: { promptTokens: 30, completionTokens: 0 },
        model: 'fake',
      },
    ]);

    const specialist = createSpecialistTool({
      name: 'demander_au_vendeur',
      description: 'Délègue au vendeur',
      role: 'vendeur',
      instructions: 'Tu es le vendeur.',
      tools: new ToolRegistry(),
      llm: fakeLlm,
    });

    const detailed = await specialist.executeDetailed!({ demande: 'Vérifie' });
    expect(detailed.result).toEqual({
      erreur: "vendeur n'a pas pu répondre",
      conseil:
        "reformuler la demande ou informer le client que l'information est momentanément indisponible",
    });
  });
});
