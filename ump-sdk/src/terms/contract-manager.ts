import type {
  Contract, ContractStatus,
  CreateContractOptions, PricingRule,
} from '../types';
import { generateId, hrTimestamp } from '../utils/id';
import { ContractNotFoundError, UMPError } from '../utils/errors';

/**
 * ContractManager — Layer 1/2 bridge
 *
 * Manages commercial agreements between agents.
 * Supports pre-negotiated, template-based, and dynamic negotiation.
 */
export class ContractManager {
  private contracts: Map<string, Contract> = new Map();

  /**
   * Create a new contract between two agents.
   */
  create(sourceAgentId: string, options: CreateContractOptions): Contract {
    const contractId = generateId('ctr');
    const now = hrTimestamp();

    // Assign rule IDs to any rules that don't have them
    const rules: PricingRule[] = options.pricingRules.map(r => ({
      ...r,
      ruleId: (r as PricingRule).ruleId || generateId('rul'),
    })) as PricingRule[];

    const contract: Contract = {
      contractId,
      mode: options.mode || 'TEMPLATE',
      status: 'ACTIVE',
      parties: {
        sourceAgentId,
        targetAgentId: options.targetAgentId,
      },
      pricingRules: rules,
      effectiveFrom: options.effectiveFrom || now,
      effectiveUntil: options.effectiveUntil,
      metadata: options.metadata || {},
      createdAt: now,
    };

    this.contracts.set(contractId, contract);
    return contract;
  }

  /**
   * Get contract by ID.
   */
  get(contractId: string): Contract {
    const contract = this.contracts.get(contractId);
    if (!contract) throw new ContractNotFoundError(contractId);
    return contract;
  }

  /**
   * Find active contract between two agents.
   */
  findActive(sourceAgentId: string, targetAgentId: string): Contract | undefined {
    const now = new Date();
    for (const c of this.contracts.values()) {
      if (
        c.status === 'ACTIVE' &&
        c.parties.sourceAgentId === sourceAgentId &&
        c.parties.targetAgentId === targetAgentId &&
        c.effectiveFrom <= now &&
        (!c.effectiveUntil || c.effectiveUntil > now)
      ) {
        return c;
      }
    }
    return undefined;
  }

  /**
   * Dynamic negotiation: propose terms.
   * Returns a DRAFT contract that the counterparty can accept or counter.
   */
  propose(sourceAgentId: string, options: CreateContractOptions): Contract {
    const contract = this.create(sourceAgentId, { ...options, mode: 'DYNAMIC' });
    contract.status = 'PROPOSED';
    return contract;
  }

  /**
   * Accept a proposed contract — transitions to ACTIVE.
   */
  accept(contractId: string): Contract {
    const contract = this.get(contractId);
    if (contract.status !== 'PROPOSED') {
      throw new UMPError(`Cannot accept contract in status: ${contract.status}`, 'INVALID_STATE');
    }
    contract.status = 'ACTIVE';
    return contract;
  }

  /**
   * Counter-propose: create a new proposal based on an existing one with modified terms.
   */
  counter(
    contractId: string,
    counterAgentId: string,
    modifiedRules: Omit<PricingRule, 'ruleId'>[],
  ): Contract {
    const original = this.get(contractId);
    original.status = 'EXPIRED'; // superseded

    return this.propose(counterAgentId, {
      targetAgentId: original.parties.sourceAgentId, // reverse direction
      pricingRules: modifiedRules,
      metadata: {
        ...original.metadata,
        counterTo: contractId,
      },
    });
  }

  /**
   * Terminate a contract.
   */
  terminate(contractId: string): Contract {
    const contract = this.get(contractId);
    contract.status = 'TERMINATED';
    return contract;
  }

  /**
   * List contracts for an agent.
   */
  listByAgent(agentId: string, status?: ContractStatus): Contract[] {
    return Array.from(this.contracts.values()).filter(c => {
      const partyMatch =
        c.parties.sourceAgentId === agentId ||
        c.parties.targetAgentId === agentId;
      if (!partyMatch) return false;
      if (status && c.status !== status) return false;
      return true;
    });
  }
}
