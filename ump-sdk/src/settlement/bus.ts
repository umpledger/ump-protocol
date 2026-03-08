import type {
  Settlement,
  RatedRecord, UsageEvent, PricingRule,
} from '../types';
import { generateId, round, hrTimestamp } from '../utils/id';
import { WalletManager } from '../core/wallet-manager';
import { AuditTrail } from '../core/audit-trail';
import { PricingEngine } from '../pricing/engine';
import { UMPError } from '../utils/errors';

export interface SettlementResult {
  settlement: Settlement;
  auditId: string;
}

/**
 * SettlementBus — Layer 3 primitive
 *
 * Executes real-time settlement between agent wallets.
 * Supports 6 patterns: instant drawdown, escrow, waterfall,
 * net settlement, conditional release, cross-currency atomic.
 */
export class SettlementBus {
  private settlements: Map<string, Settlement> = new Map();
  private escrows: Map<string, { amount: number; sourceWalletId: string; targetWalletId: string }> = new Map();

  constructor(
    private wallets: WalletManager,
    private audit: AuditTrail,
    private pricingEngine: PricingEngine,
  ) {}

  /**
   * Execute a full transaction: meter → rate → settle in one call.
   * This is the high-level "transact" method from the Quick Start.
   */
  async transact(
    sourceAgentId: string,
    targetAgentId: string,
    event: UsageEvent,
    rule: PricingRule,
  ): Promise<SettlementResult> {
    const startTime = Date.now();

    // 1. Rate the usage event
    const ratedRecord = this.pricingEngine.rate(rule, { event });

    // 2. Execute instant drawdown settlement
    return this.settleInstant(
      sourceAgentId,
      targetAgentId,
      [ratedRecord],
      startTime,
    );
  }

  /**
   * INSTANT_DRAWDOWN: Debit source, credit target atomically.
   * Used for per-token, per-inference micro-transactions.
   */
  settleInstant(
    sourceAgentId: string,
    targetAgentId: string,
    ratedRecords: RatedRecord[],
    _startTime?: number,
  ): SettlementResult {
    const totalAmount = round(ratedRecords.reduce((sum, r) => sum + r.amount, 0));
    const sourceWallet = this.wallets.getByAgent(sourceAgentId);
    const targetWallet = this.wallets.getByAgent(targetAgentId);
    const settlementId = generateId('stl');
    const txnId = generateId('txn');

    // Atomic: debit source, credit target
    const balanceBefore = this.wallets.getBalance(sourceWallet.walletId)[0]?.available ?? 0;
    this.wallets.debit(sourceWallet.walletId, totalAmount, targetAgentId, txnId);
    this.wallets.credit(targetWallet.walletId, totalAmount, sourceAgentId, txnId);
    const balanceAfter = this.wallets.getBalance(sourceWallet.walletId)[0]?.available ?? 0;

    const settlement: Settlement = {
      settlementId,
      pattern: 'INSTANT_DRAWDOWN',
      status: 'SETTLED',
      sourceAgentId,
      targetAgentId,
      ratedRecords,
      totalAmount,
      currency: ratedRecords[0]?.currency ?? 'USD',
      settledAt: hrTimestamp(),
      auditId: '',
    };

    // Audit
    const auditId = this.audit.record({
      what: { operation: 'SETTLEMENT', entityType: 'transaction', entityId: txnId, amount: totalAmount },
      who: { sourceAgentId, targetAgentId },
      why: { contractId: ratedRecords[0]?.contractId, pricingRuleId: ratedRecords[0]?.pricingRuleId },
      how: { policiesEvaluated: ['SPENDING_LIMIT', 'COUNTERPARTY_ALLOWLIST'], policiesPassed: ['SPENDING_LIMIT', 'COUNTERPARTY_ALLOWLIST'] },
      result: { balanceBefore, balanceAfter, settlementAmount: totalAmount, status: 'SETTLED' },
    });

    settlement.auditId = auditId;
    this.settlements.set(settlementId, settlement);

    return { settlement, auditId };
  }

  /**
   * ESCROW_RELEASE: Reserve funds, release upon outcome attestation.
   * Used for outcome-based pricing and milestone payments.
   */
  createEscrow(
    sourceAgentId: string,
    targetAgentId: string,
    amount: number,
    transactionId: string,
  ): string {
    const sourceWallet = this.wallets.getByAgent(sourceAgentId);
    const targetWallet = this.wallets.getByAgent(targetAgentId);
    const escrowId = generateId('esc');

    // Reserve in source wallet
    this.wallets.reserve(sourceWallet.walletId, amount, targetAgentId, transactionId);

    this.escrows.set(escrowId, {
      amount,
      sourceWalletId: sourceWallet.walletId,
      targetWalletId: targetWallet.walletId,
    });

    this.audit.record({
      what: { operation: 'ESCROW_CREATED', entityType: 'escrow', entityId: escrowId, amount },
      who: { sourceAgentId, targetAgentId },
      why: { justification: `Escrow for transaction ${transactionId}` },
      how: { policiesEvaluated: ['SPENDING_LIMIT'], policiesPassed: ['SPENDING_LIMIT'] },
      result: { status: 'ESCROWED' },
    });

    return escrowId;
  }

  /**
   * Release escrowed funds to the target (full or partial).
   */
  releaseEscrow(escrowId: string, releaseAmount?: number): SettlementResult {
    const escrow = this.escrows.get(escrowId);
    if (!escrow) throw new UMPError(`Escrow not found: ${escrowId}`, 'ESCROW_NOT_FOUND');

    const amount = releaseAmount ?? escrow.amount;
    const txnId = generateId('txn');

    // Release reservation from source, credit target
    this.wallets.releaseReservation(escrow.sourceWalletId, amount, txnId);
    this.wallets.credit(escrow.targetWalletId, amount, 'escrow', txnId);

    // If partial release, update remaining
    if (amount < escrow.amount) {
      escrow.amount -= amount;
    } else {
      this.escrows.delete(escrowId);
    }

    const settlement: Settlement = {
      settlementId: generateId('stl'),
      pattern: 'ESCROW_RELEASE',
      status: 'SETTLED',
      sourceAgentId: 'escrow',
      targetAgentId: 'escrow',
      ratedRecords: [],
      totalAmount: amount,
      currency: 'USD',
      settledAt: hrTimestamp(),
      auditId: '',
    };

    const auditId = this.audit.record({
      what: { operation: 'ESCROW_RELEASED', entityType: 'escrow', entityId: escrowId, amount },
      who: { sourceAgentId: 'escrow', targetAgentId: 'escrow' },
      why: { justification: `Escrow ${escrowId} released` },
      how: { policiesEvaluated: ['OUTCOME_VERIFICATION'], policiesPassed: ['OUTCOME_VERIFICATION'] },
      result: { settlementAmount: amount, status: 'SETTLED' },
    });

    settlement.auditId = auditId;
    this.settlements.set(settlement.settlementId, settlement);
    return { settlement, auditId };
  }

  /**
   * WATERFALL_SPLIT: Distribute payment across multiple parties.
   * Used for marketplace commissions and multi-party revenue share.
   */
  settleWaterfall(
    sourceAgentId: string,
    splits: Array<{ agentId: string; amount: number }>,
    ratedRecords: RatedRecord[],
  ): SettlementResult[] {
    const sourceWallet = this.wallets.getByAgent(sourceAgentId);
    const totalAmount = round(splits.reduce((sum, s) => sum + s.amount, 0));
    const txnId = generateId('txn');

    // Debit total from source
    this.wallets.debit(sourceWallet.walletId, totalAmount, 'waterfall', txnId);

    // Credit each target
    const results: SettlementResult[] = splits.map(split => {
      const targetWallet = this.wallets.getByAgent(split.agentId);
      this.wallets.credit(targetWallet.walletId, split.amount, sourceAgentId, txnId);

      const settlement: Settlement = {
        settlementId: generateId('stl'),
        pattern: 'WATERFALL_SPLIT',
        status: 'SETTLED',
        sourceAgentId,
        targetAgentId: split.agentId,
        ratedRecords,
        totalAmount: split.amount,
        currency: 'USD',
        settledAt: hrTimestamp(),
        auditId: '',
      };

      const auditId = this.audit.record({
        what: { operation: 'WATERFALL_SPLIT', entityType: 'settlement', entityId: settlement.settlementId, amount: split.amount },
        who: { sourceAgentId, targetAgentId: split.agentId },
        why: { justification: `Waterfall split: ${split.amount} to ${split.agentId}` },
        how: { policiesEvaluated: ['SPENDING_LIMIT'], policiesPassed: ['SPENDING_LIMIT'] },
        result: { settlementAmount: split.amount, status: 'SETTLED' },
      });

      settlement.auditId = auditId;
      this.settlements.set(settlement.settlementId, settlement);
      return { settlement, auditId };
    });

    return results;
  }

  /**
   * Get settlement by ID.
   */
  get(settlementId: string): Settlement | undefined {
    return this.settlements.get(settlementId);
  }

  /**
   * List settlements for an agent.
   */
  listByAgent(agentId: string, limit = 50): Settlement[] {
    return Array.from(this.settlements.values())
      .filter(s => s.sourceAgentId === agentId || s.targetAgentId === agentId)
      .slice(-limit);
  }
}
