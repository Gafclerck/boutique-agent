export interface ApprovalRequest {
  readonly toolName: string;
  readonly recapitulatif: string;
  readonly details?: Record<string, unknown>;
}

export interface ApprovalDecision {
  readonly approved: boolean;
  readonly reason?: string;
}

export interface ApprovalPort {
  request(req: ApprovalRequest): Promise<ApprovalDecision>;
}
