import { describe, expect, it } from 'vitest';
import { INITIAL_PRODUCTS } from '../src/domain/catalogue.js';
import { evaluateReply } from '../src/agent/evaluation/index.js';
import type { EvaluationInput } from '../src/agent/evaluation/types.js';
import type { TraceEvent } from '../src/agent/trace.js';

describe('Règle d évaluation commandeEnAttente', () => {
  const baseInput: EvaluationInput = {
    userMessage: 'oui je confirme',
    reply: '',
    trace: [],
    catalogue: INITIAL_PRODUCTS,
    hasPriorCatalogueLookup: true,
  };

  it('non concerné si aucun order_submitted dans la trace', () => {
    const input: EvaluationInput = {
      ...baseInput,
      userMessage: 'combien pour la livraison ?',
      reply: 'Souhaitez-vous confirmer votre commande ?',
      trace: [
        {
          type: 'tool_call',
          name: 'calculer_total',
          arguments: {},
          result: { total_fcfa: 15000 },
          step: 1,
          agent: 'agent',
          durationMs: 10,
        },
      ],
    };

    const verdict = evaluateReply(input);
    const violation = verdict.violations.find(
      (v) => v.rule === 'commandeEnAttente',
    );
    expect(violation).toBeUndefined();
  });

  it('accepte une réponse mentionnant attente de validation après soumission', () => {
    const traceWithSubmission: TraceEvent[] = [
      {
        type: 'order_submitted',
        numero: 12,
        cancelledNumbers: [],
        step: 1,
        agent: 'agent',
      },
    ];

    const input: EvaluationInput = {
      ...baseInput,
      reply:
        'Votre commande est en attente de validation par la boutique. Vous serez prévenu dès qu elle sera traitée.',
      trace: traceWithSubmission,
    };

    const verdict = evaluateReply(input);
    const violation = verdict.violations.find(
      (v) => v.rule === 'commandeEnAttente',
    );
    expect(violation).toBeUndefined();
  });

  it('viole la règle si la réponse affirme que la commande est confirmée sans mentionner attente', () => {
    const traceWithSubmission: TraceEvent[] = [
      {
        type: 'order_submitted',
        numero: 12,
        cancelledNumbers: [],
        step: 1,
        agent: 'agent',
      },
    ];

    const input: EvaluationInput = {
      ...baseInput,
      reply: 'Votre commande est confirmée ! Nous préparons votre colis.',
      trace: traceWithSubmission,
    };

    const verdict = evaluateReply(input);
    const violation = verdict.violations.find(
      (v) => v.rule === 'commandeEnAttente',
    );
    expect(violation).toBeDefined();
    expect(violation?.rule).toBe('commandeEnAttente');
    expect(violation?.critique).toContain(
      "la commande est seulement transmise à la boutique pour validation",
    );
  });

  it('viole la règle si la réponse dit enregistrée ou validée sans mentionner attente', () => {
    const traceWithSubmission: TraceEvent[] = [
      {
        type: 'order_submitted',
        numero: 12,
        cancelledNumbers: [],
        step: 1,
        agent: 'agent',
      },
    ];

    const inputEnregistree: EvaluationInput = {
      ...baseInput,
      reply: 'Votre commande a bien été enregistrée définitivement.',
      trace: traceWithSubmission,
    };
    expect(
      evaluateReply(inputEnregistree).violations.some(
        (v) => v.rule === 'commandeEnAttente',
      ),
    ).toBe(true);

    const inputValidee: EvaluationInput = {
      ...baseInput,
      reply: 'Votre commande est validée !',
      trace: traceWithSubmission,
    };
    expect(
      evaluateReply(inputValidee).violations.some(
        (v) => v.rule === 'commandeEnAttente',
      ),
    ).toBe(true);
  });
});
