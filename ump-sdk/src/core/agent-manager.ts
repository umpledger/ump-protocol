import type {
  AgentIdentity, AgentStatus, AgentType, AuthorityScope,
  CreateAgentOptions, VerificationProof,
} from '../types';
import { generateId, parseMoney, hrTimestamp } from '../utils/id';
import { AgentNotFoundError, AgentRevokedError } from '../utils/errors';
import crypto from 'crypto';

/**
 * AgentManager — Layer 1 primitive
 *
 * Manages Agent Identity lifecycle: creation, verification,
 * authority scope enforcement, hierarchical revocation.
 */
export class AgentManager {
  private agents: Map<string, AgentIdentity> = new Map();

  /**
   * Register a new Agent Identity with authority scope.
   */
  create(options: CreateAgentOptions): AgentIdentity {
    const agentId = generateId('agt');
    const now = hrTimestamp();

    // Generate ephemeral keypair for this agent
    const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
    const pubKeyHex = publicKey.export({ type: 'spki', format: 'der' }).toString('hex');

    // Normalize authority scope — parse "$50" strings into numbers
    const authority: AuthorityScope = {
      maxPerTransaction: parseMoney(options.authority.maxPerTransaction),
      maxPerDay: parseMoney(options.authority.maxPerDay),
      maxPerMonth: options.authority.maxPerMonth
        ? parseMoney(options.authority.maxPerMonth)
        : parseMoney(options.authority.maxPerDay) * 30,
      allowedServices: options.authority.allowedServices,
      allowedCounterparties: options.authority.allowedCounterparties,
      requiresApprovalAbove: options.authority.requiresApprovalAbove,
      autoRevokeAfter: options.authority.autoRevokeAfter,
    };

    // If parent exists, child authority cannot exceed parent's
    if (options.parentId) {
      const parent = this.get(options.parentId);
      authority.maxPerTransaction = Math.min(authority.maxPerTransaction, parent.authorityScope.maxPerTransaction);
      authority.maxPerDay = Math.min(authority.maxPerDay, parent.authorityScope.maxPerDay);
      authority.maxPerMonth = Math.min(authority.maxPerMonth, parent.authorityScope.maxPerMonth);
    }

    const verification: VerificationProof = {
      publicKey: pubKeyHex,
      issuingAuthority: 'ump-sdk-local',
      expiresAt: new Date(now.getTime() + (options.authority.autoRevokeAfter || 365 * 24 * 60 * 60 * 1000)),
    };

    const agent: AgentIdentity = {
      agentId,
      agentType: options.type,
      parentId: options.parentId || null,
      displayName: options.name,
      capabilities: options.capabilities || [],
      authorityScope: authority,
      verification,
      metadata: {
        ...options.metadata,
        _privateKey: privateKey.export({ type: 'pkcs8', format: 'der' }).toString('hex'),
      },
      status: 'ACTIVE',
      createdAt: now,
      updatedAt: now,
    };

    this.agents.set(agentId, agent);

    // Schedule auto-revoke if set
    if (options.authority.autoRevokeAfter) {
      setTimeout(() => this.revoke(agentId), options.authority.autoRevokeAfter);
    }

    return agent;
  }

  /**
   * Retrieve an agent by ID.
   */
  get(agentId: string): AgentIdentity {
    const agent = this.agents.get(agentId);
    if (!agent) throw new AgentNotFoundError(agentId);
    return agent;
  }

  /**
   * Update authority scope (tightening is always allowed; loosening requires parent).
   */
  updateAuthority(agentId: string, newScope: Partial<AuthorityScope>): AgentIdentity {
    const agent = this.get(agentId);
    if (agent.status !== 'ACTIVE') throw new AgentRevokedError(agentId);

    const updated: AgentIdentity = {
      ...agent,
      authorityScope: { ...agent.authorityScope, ...newScope },
      updatedAt: hrTimestamp(),
    };

    this.agents.set(agentId, updated);
    return updated;
  }

  /**
   * Revoke an agent and cascade to all children.
   */
  revoke(agentId: string): string[] {
    const revoked: string[] = [];
    const agent = this.agents.get(agentId);
    if (!agent) return revoked;

    agent.status = 'REVOKED';
    agent.updatedAt = hrTimestamp();
    revoked.push(agentId);

    // Cascade: revoke all children
    for (const [id, a] of this.agents) {
      if (a.parentId === agentId && a.status === 'ACTIVE') {
        revoked.push(...this.revoke(id));
      }
    }

    return revoked;
  }

  /**
   * Verify that an agent's identity is valid and active.
   */
  verify(agentId: string): { valid: boolean; reason?: string } {
    const agent = this.agents.get(agentId);
    if (!agent) return { valid: false, reason: 'Agent not found' };
    if (agent.status !== 'ACTIVE') return { valid: false, reason: `Agent status: ${agent.status}` };
    if (agent.verification.expiresAt < new Date()) {
      agent.status = 'EXPIRED';
      return { valid: false, reason: 'Verification expired' };
    }
    return { valid: true };
  }

  /**
   * Check if a transaction amount is within the agent's authority scope.
   */
  checkAuthority(
    agentId: string,
    amount: number,
    counterpartyId?: string,
    serviceId?: string
  ): { allowed: boolean; reason?: string; requiresApproval?: boolean } {
    const agent = this.get(agentId);
    const scope = agent.authorityScope;

    if (agent.status !== 'ACTIVE') {
      return { allowed: false, reason: `Agent status: ${agent.status}` };
    }

    if (amount > scope.maxPerTransaction) {
      return { allowed: false, reason: `Exceeds per-transaction limit of ${scope.maxPerTransaction}` };
    }

    if (scope.allowedCounterparties && counterpartyId) {
      const allowed = scope.allowedCounterparties.some(pattern => {
        if (pattern.endsWith('*')) {
          return counterpartyId.startsWith(pattern.slice(0, -1));
        }
        return counterpartyId === pattern;
      });
      if (!allowed) {
        return { allowed: false, reason: `Counterparty ${counterpartyId} not in allowlist` };
      }
    }

    if (scope.allowedServices && serviceId) {
      if (!scope.allowedServices.includes(serviceId)) {
        return { allowed: false, reason: `Service ${serviceId} not in allowlist` };
      }
    }

    if (scope.requiresApprovalAbove && amount > scope.requiresApprovalAbove) {
      return { allowed: true, requiresApproval: true };
    }

    return { allowed: true };
  }

  /**
   * List all agents, optionally filtered.
   */
  list(filter?: { parentId?: string; type?: AgentType; status?: AgentStatus }): AgentIdentity[] {
    let results = Array.from(this.agents.values());
    if (filter?.parentId) results = results.filter(a => a.parentId === filter.parentId);
    if (filter?.type) results = results.filter(a => a.agentType === filter.type);
    if (filter?.status) results = results.filter(a => a.status === filter.status);
    return results;
  }
}
