export interface AfiDecisionCommand {
  readonly decision: 'oui' | 'non';
  readonly numero: number;
}

const AFI_COMMAND_PATTERN = /^(oui|non)\s+#?(\d{1,6})$/;

/**
 * Parses a message from Afi to extract her approval or refusal decision.
 * Format accepted after trim and lowercase: exactly /^(oui|non)\s+#?(\d{1,6})$/
 */
export function parseAfiDecision(text: unknown): AfiDecisionCommand | null {
  if (typeof text !== 'string') {
    return null;
  }

  const normalized = text.trim().toLowerCase();
  const match = normalized.match(AFI_COMMAND_PATTERN);

  if (!match) {
    return null;
  }

  const [, rawDecision, rawNumero] = match;
  if (!rawDecision || !rawNumero) {
    return null;
  }

  const decision = rawDecision as 'oui' | 'non';
  const numero = parseInt(rawNumero, 10);

  return {
    decision,
    numero,
  };
}

/**
 * Predicate to quickly test whether a message matches Afi command pattern.
 */
export function looksLikeAfiCommand(text: unknown): boolean {
  return parseAfiDecision(text) !== null;
}
