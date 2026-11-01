import type {
  ApprovalDecision,
  ApprovalPort,
  ApprovalRequest,
} from '../../ports/approval.js';

export class FakeApproval implements ApprovalPort {
  public readonly requests: ApprovalRequest[] = [];
  private decisions: ApprovalDecision[];

  constructor(decisions: ApprovalDecision[] = []) {
    this.decisions = [...decisions];
  }

  public addDecision(decision: ApprovalDecision): void {
    this.decisions.push(decision);
  }

  public async request(req: ApprovalRequest): Promise<ApprovalDecision> {
    this.requests.push(req);
    const decision = this.decisions.shift();
    if (!decision) {
      return {
        approved: false,
        reason: 'aucune décision scriptée',
      };
    }
    return decision;
  }
}
