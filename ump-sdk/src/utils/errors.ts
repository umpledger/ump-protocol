/**
 * UMP Error Hierarchy
 * All SDK errors extend UMPError for easy catch-all handling.
 */

export class UMPError extends Error {
  public readonly code: string;

  constructor(message: string, code: string) {
    super(message);
    this.name = 'UMPError';
    this.code = code;
  }
}

export class AuthorityExceededError extends UMPError {
  public readonly limit: number;
  public readonly attempted: number;

  constructor(limitType: string, limit: number, attempted: number) {
    super(
      `Authority exceeded: ${limitType} limit is ${limit}, attempted ${attempted}`,
      'AUTHORITY_EXCEEDED'
    );
    this.name = 'AuthorityExceededError';
    this.limit = limit;
    this.attempted = attempted;
  }
}

export class InsufficientFundsError extends UMPError {
  public readonly available: number;
  public readonly required: number;

  constructor(available: number, required: number) {
    super(
      `Insufficient funds: available ${available}, required ${required}`,
      'INSUFFICIENT_FUNDS'
    );
    this.name = 'InsufficientFundsError';
    this.available = available;
    this.required = required;
  }
}

export class WalletFrozenError extends UMPError {
  constructor(walletId: string) {
    super(`Wallet ${walletId} is frozen — all transactions blocked`, 'WALLET_FROZEN');
    this.name = 'WalletFrozenError';
  }
}

export class AgentNotFoundError extends UMPError {
  constructor(agentId: string) {
    super(`Agent not found: ${agentId}`, 'AGENT_NOT_FOUND');
    this.name = 'AgentNotFoundError';
  }
}

export class AgentRevokedError extends UMPError {
  constructor(agentId: string) {
    super(`Agent ${agentId} has been revoked`, 'AGENT_REVOKED');
    this.name = 'AgentRevokedError';
  }
}

export class ContractNotFoundError extends UMPError {
  constructor(contractId: string) {
    super(`Contract not found: ${contractId}`, 'CONTRACT_NOT_FOUND');
    this.name = 'ContractNotFoundError';
  }
}

export class PolicyViolationError extends UMPError {
  public readonly policyType: string;
  public readonly action: string;

  constructor(policyType: string, action: string, details: string) {
    super(`Policy violation [${policyType}]: ${details}`, 'POLICY_VIOLATION');
    this.name = 'PolicyViolationError';
    this.policyType = policyType;
    this.action = action;
  }
}

export class DisputeError extends UMPError {
  constructor(message: string) {
    super(message, 'DISPUTE_ERROR');
    this.name = 'DisputeError';
  }
}
