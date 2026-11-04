import { describe, expect, it } from 'vitest';
import { FakeLlm } from '../src/adapters/llm/fake-llm.js';
import { createRunner, resolveRunnerMode } from '../src/agent/runners.js';
import { Shop } from '../src/domain/shop.js';

describe('TACHE E : Assembleur commun createRunner', () => {
  it('resolveRunnerMode résout correctement argv et variable d\'environnement', () => {
    expect(resolveRunnerMode([])).toBe('single');
    expect(resolveRunnerMode(['--mode', 'team'])).toBe('team');
    expect(resolveRunnerMode(['--mode=team'])).toBe('team');
    expect(resolveRunnerMode(['--mode=single'])).toBe('single');
    expect(resolveRunnerMode([], 'team')).toBe('team');
    expect(resolveRunnerMode([], 'single')).toBe('single');
  });

  it('mode single : rôle "agent", mêmes instructions et outils par défaut', async () => {
    const fakeLlm = new FakeLlm([
      {
        message: { role: 'assistant', content: 'Bonjour cher client !' },
        usage: { promptTokens: 30, completionTokens: 10 },
        model: 'fake',
      },
    ]);

    const shop = new Shop();
    const runner = createRunner({
      mode: 'single',
      llm: fakeLlm,
      shop,
    });

    const res = await runner({ userMessage: 'Bonjour' });
    expect(res.stopReason).toBe('answered');
    expect(fakeLlm.requests[0]?.role).toBe('agent');
    expect(res.reply).toBe('Bonjour cher client !');
    expect(res.trace[0]?.agent).toBe('agent');
  });

  it('mode team : rôle "gerant", outils spécialistes branchés', async () => {
    const fakeLlm = new FakeLlm({
      gerant: [
        {
          message: { role: 'assistant', content: 'Bienvenue chez Afi !' },
          usage: { promptTokens: 40, completionTokens: 10 },
          model: 'fake',
        },
      ],
    });

    const shop = new Shop();
    const runner = createRunner({
      mode: 'team',
      llm: fakeLlm,
      shop,
    });

    const res = await runner({ userMessage: 'Salut' });
    expect(res.stopReason).toBe('answered');
    expect(res.trace[0]?.agent).toBe('gerant');
    expect(fakeLlm.requests[0]?.role).toBe('gerant');
  });
});
