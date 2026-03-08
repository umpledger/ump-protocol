/**
 * ═══════════════════════════════════════════════════════════════
 * @ump/sdk — Universal Monetization Protocol v2.0
 *
 * The payment rail for the autonomous economy.
 * When AI agents transact with AI agents, UMP governs
 * how value flows between them.
 *
 * Quick Start:
 *   const ump = new UMP({ apiKey: "ump_sk_..." });
 *   const agent = ump.agents.create({ name: "my-agent", type: "AI_AGENT", authority: { maxPerTransaction: "$50", maxPerDay: "$500" } });
 *   await ump.transact({ from: agent.agentId, to: "agent_target", service: "code_review" });
 *
 * Architecture: 3 layers
 *   L1: Identity & Value  (AgentManager, WalletManager)
 *   L2: Terms & Metering  (ContractManager, MeteringEngine, PricingEngine)
 *   L3: Settlement & Gov  (SettlementBus, AuditTrail)
 *
 * © 2026 UMPLedger — Apache 2.0 License
 * ═══════════════════════════════════════════════════════════════
 */

import type {
  UMPConfig, TransactOptions, TransactionResult,
  CreateAgentOptions, AgentIdentity, FundWalletOptions, PricingRule,
} from './types';
import { AgentManager } from './core/agent-manager';
import { WalletManager } from './core/wallet-manager';
import { AuditTrail } from './core/audit-trail';
import { PricingEngine } from './pricing/engine';
import { ContractManager } from './terms/contract-manager';
import { MeteringEngine } from './terms/metering';
import { SettlementBus } from './settlement/bus';
import { generateId, parseMoney } from './utils/id';
import { AgentRevokedError, UMPError } from './utils/errors';

/**
 * Convenience wrapper: an agent + its wallet in one object.
 */
export interface AgentHandle {
  id: string;
  agent: AgentIdentity;
  wallet: {
    fund: (options: FundWalletOptions) => void;
    balance: () => number;
    freeze: () => void;
    unfreeze: () => void;
  };
}

/**
 * UMP — Main SDK Entry Point
 *
 * Orchestrates all three protocol layers through a clean API.
 */
export class UMP {
  // ── Layer 1: Identity & Value ──
  public readonly agents: AgentManager;
  public readonly wallets: WalletManager;

  // ── Layer 2: Terms & Metering ──
  public readonly contracts: ContractManager;
  public readonly metering: MeteringEngine;
  public readonly pricing: PricingEngine;

  // ── Layer 3: Settlement & Governance ──
  public readonly settlement: SettlementBus;
  public readonly audit: AuditTrail;

  constructor(config: UMPConfig) {
    // Initialize all subsystems
    this.agents = new AgentManager();
    this.wallets = new WalletManager();
    this.audit = new AuditTrail(config.onAudit);
    this.pricing = new PricingEngine();
    this.contracts = new ContractManager();
    this.metering = new MeteringEngine();
    this.settlement = new SettlementBus(this.wallets, this.audit, this.pricing);
  }

  /**
   * High-level: Register an agent and create its wallet.
   * Returns an AgentHandle with convenience methods.
   */
  registerAgent(options: CreateAgentOptions): AgentHandle {
    const agent = this.agents.create(options);
    const wallet = this.wallets.create(agent.agentId);

    return {
      id: agent.agentId,
      agent,
      wallet: {
        fund: (opts: FundWalletOptions) => {
          this.wallets.fund(wallet.walletId, opts);
        },
        balance: () => {
          const balances = this.wallets.getBalance(wallet.walletId);
          return balances[0]?.available ?? 0;
        },
        freeze: () => this.wallets.freeze(wallet.walletId),
        unfreeze: () => this.wallets.unfreeze(wallet.walletId),
      },
    };
  }

  /**
   * High-level: Execute a priced transaction between two agents.
   *
   * This is the "10 lines of code" Quick Start method.
   * It finds or creates a contract, meters the event, rates it,
   * settles payment, and returns the result — all in one call.
   */
  async transact(options: TransactOptions): Promise<TransactionResult> {
    const startTime = Date.now();
    const txnId = generateId('txn');

    // 1. Validate agents
    const sourceCheck = this.agents.verify(options.from);
    if (!sourceCheck.valid) {
      throw new AgentRevokedError(options.from);
    }

    // 2. Find or create contract
    let contract = this.contracts.findActive(options.from, options.to);
    if (!contract) {
      // Auto-create a template contract with default per-unit pricing
      contract = this.contracts.create(options.from, {
        targetAgentId: options.to,
        pricingRules: [{
          name: 'Default per-unit',
          primitive: 'UNIT_RATE',
        } as Omit<PricingRule, 'ruleId'>],
      });
    }

    // 3. Check authority
    const maxCost = options.maxCost ? parseMoney(options.maxCost) : undefined;
    if (maxCost) {
      const authCheck = this.agents.checkAuthority(options.from, maxCost, options.to, options.service);
      if (!authCheck.allowed) {
        throw new UMPError(`Authority check failed: ${authCheck.reason}`, 'AUTHORITY_EXCEEDED');
      }
    }

    // 4. Meter the event
    const event = this.metering.record({
      sourceAgentId: options.from,
      targetAgentId: options.to,
      contractId: contract.contractId,
      serviceId: options.service,
      quantity: 1,
      unit: 'API_CALL',
      dimensions: (options.payload as Record<string, string | number>) || {},
    });

    // 5. Rate + Settle
    const rule = contract.pricingRules[0];
    const { settlement, auditId } = await this.settlement.transact(
      options.from,
      options.to,
      event,
      rule,
    );

    return {
      transactionId: txnId,
      cost: settlement.totalAmount,
      currency: settlement.currency,
      outcome: event.outcome,
      auditId,
      settledAt: settlement.settledAt || new Date(),
      duration: Date.now() - startTime,
    };
  }
}

// ── Re-exports ──────────────────────────────────────────────

export { AgentManager } from './core/agent-manager';
export { WalletManager } from './core/wallet-manager';
export { AuditTrail } from './core/audit-trail';
export { PricingEngine, type RatingContext } from './pricing/engine';
export { PricingTemplates } from './pricing/templates';
export { ContractManager } from './terms/contract-manager';
export { MeteringEngine } from './terms/metering';
export { SettlementBus, type SettlementResult } from './settlement/bus';
export * from './types';
export * from './utils/errors';
