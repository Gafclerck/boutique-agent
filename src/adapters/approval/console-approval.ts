import type {
  ApprovalDecision,
  ApprovalPort,
  ApprovalRequest,
} from '../../ports/approval.js';

export type AskFunction = (question: string) => Promise<string>;

export class ConsoleApproval implements ApprovalPort {
  constructor(
    private readonly ask: AskFunction,
    private readonly isInteractive: () => boolean = () => process.stdin.isTTY ?? false,
  ) {}

  public async request(req: ApprovalRequest): Promise<ApprovalDecision> {
    if (!this.isInteractive()) {
      return {
        approved: false,
        reason: 'terminal non interactif (stdin non TTY)',
      };
    }

    console.log('\n' + req.recapitulatif + '\n');
    const answer = await this.ask('Valider la commande ? [o/N] ');
    const trimmed = answer.trim().toLowerCase();
    const approved =
      trimmed === 'o' ||
      trimmed === 'oui' ||
      trimmed === 'y' ||
      trimmed === 'yes';

    return {
      approved,
      reason: approved
        ? 'validée par l’utilisateur'
        : 'refusée par l’utilisateur',
    };
  }
}
