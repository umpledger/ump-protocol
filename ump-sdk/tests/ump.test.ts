import { describe, it, expect, beforeEach } from 'vitest';
import { UMP, PricingTemplates, PricingEngine } from '../src';

describe('UMP SDK v2.0', () => {
  let ump: UMP;

  beforeEach(() => {
    ump = new UMP({ apiKey: 'ump_sk_test_123' });
  });

  // ═══════════════════════════════════════════════════════════
  // LAYER 1: Identity & Value
  // ═══════════════════════════════════════════════════════════

  describe('Agent Identity', () => {
    it('should create an agent with authority scope', () => {
      const agent = ump.agents.create({
        name: 'test-agent',
        type: 'AI_AGENT',
        authority: { maxPerTransaction: '$50', maxPerDay: '$500' },
      });

      expect(agent.agentId).toMatch(/^agt_/);
      expect(agent.displayName).toBe('test-agent');
      expect(agent.agentType).toBe('AI_AGENT');
      expect(agent.authorityScope.maxPerTransaction).toBe(50);
      expect(agent.authorityScope.maxPerDay).toBe(500);
      expect(agent.status).toBe('ACTIVE');
    });

    it('should enforce child authority cannot exceed parent', () => {
      const parent = ump.agents.create({
        name: 'parent-org',
        type: 'ORGANIZATION',
        authority: { maxPerTransaction: '$100', maxPerDay: '$1000' },
      });

      const child = ump.agents.create({
        name: 'child-agent',
        type: 'AI_AGENT',
        parentId: parent.agentId,
        authority: { maxPerTransaction: '$200', maxPerDay: '$2000' }, // exceeds parent
      });

      // Child should be capped at parent's limits
      expect(child.authorityScope.maxPerTransaction).toBe(100);
      expect(child.authorityScope.maxPerDay).toBe(1000);
    });

    it('should cascade revocation to children', () => {
      const parent = ump.agents.create({
        name: 'parent',
        type: 'ORGANIZATION',
        authority: { maxPerTransaction: 100, maxPerDay: 1000 },
      });

      const child1 = ump.agents.create({
        name: 'child-1',
        type: 'AI_AGENT',
        parentId: parent.agentId,
        authority: { maxPerTransaction: 50, maxPerDay: 500 },
      });

      const child2 = ump.agents.create({
        name: 'child-2',
        type: 'AI_AGENT',
        parentId: parent.agentId,
        authority: { maxPerTransaction: 50, maxPerDay: 500 },
      });

      const revoked = ump.agents.revoke(parent.agentId);
      expect(revoked).toContain(parent.agentId);
      expect(revoked).toContain(child1.agentId);
      expect(revoked).toContain(child2.agentId);
      expect(ump.agents.get(child1.agentId).status).toBe('REVOKED');
    });

    it('should check authority for counterparty allowlist', () => {
      const agent = ump.agents.create({
        name: 'restricted-agent',
        type: 'AI_AGENT',
        authority: {
          maxPerTransaction: 100,
          maxPerDay: 1000,
          allowedCounterparties: ['agt_acme_*', 'agt_specific_123'],
        },
      });

      const allowed = ump.agents.checkAuthority(agent.agentId, 50, 'agt_acme_test');
      expect(allowed.allowed).toBe(true);

      const blocked = ump.agents.checkAuthority(agent.agentId, 50, 'agt_evil_corp');
      expect(blocked.allowed).toBe(false);
      expect(blocked.reason).toContain('not in allowlist');
    });
  });

  describe('Wallet', () => {
    it('should create a wallet and fund it', () => {
      const handle = ump.registerAgent({
        name: 'funded-agent',
        type: 'AI_AGENT',
        authority: { maxPerTransaction: 100, maxPerDay: 1000 },
      });

      handle.wallet.fund({ amount: '$100' });
      expect(handle.wallet.balance()).toBe(100);
    });

    it('should debit and credit between wallets', () => {
      const source = ump.registerAgent({
        name: 'buyer',
        type: 'AI_AGENT',
        authority: { maxPerTransaction: 100, maxPerDay: 1000 },
      });
      const target = ump.registerAgent({
        name: 'seller',
        type: 'SERVICE',
        authority: { maxPerTransaction: 100, maxPerDay: 1000 },
      });

      source.wallet.fund({ amount: 100 });

      const sourceWallet = ump.wallets.getByAgent(source.id);
      const targetWallet = ump.wallets.getByAgent(target.id);

      ump.wallets.debit(sourceWallet.walletId, 25, target.id, 'txn_test');
      ump.wallets.credit(targetWallet.walletId, 25, source.id, 'txn_test');

      expect(source.wallet.balance()).toBe(75);
      expect(target.wallet.balance()).toBe(25);
    });

    it('should reject transactions on frozen wallet', () => {
      const handle = ump.registerAgent({
        name: 'freeze-test',
        type: 'AI_AGENT',
        authority: { maxPerTransaction: 100, maxPerDay: 1000 },
      });

      handle.wallet.fund({ amount: 100 });
      handle.wallet.freeze();

      const wallet = ump.wallets.getByAgent(handle.id);
      expect(() => {
        ump.wallets.debit(wallet.walletId, 10, 'other', 'txn_test');
      }).toThrow('frozen');
    });

    it('should reject insufficient funds', () => {
      const handle = ump.registerAgent({
        name: 'broke-agent',
        type: 'AI_AGENT',
        authority: { maxPerTransaction: 100, maxPerDay: 1000 },
      });

      handle.wallet.fund({ amount: 5 });

      const wallet = ump.wallets.getByAgent(handle.id);
      expect(() => {
        ump.wallets.debit(wallet.walletId, 50, 'other', 'txn_test');
      }).toThrow('Insufficient funds');
    });

    it('should maintain immutable ledger', () => {
      const handle = ump.registerAgent({
        name: 'ledger-test',
        type: 'AI_AGENT',
        authority: { maxPerTransaction: 100, maxPerDay: 1000 },
      });

      const wallet = ump.wallets.getByAgent(handle.id);
      handle.wallet.fund({ amount: 100 });
      ump.wallets.debit(wallet.walletId, 30, 'other', 'txn_1');
      ump.wallets.credit(wallet.walletId, 10, 'other', 'txn_2');

      const ledger = ump.wallets.getLedger(wallet.walletId);
      expect(ledger).toHaveLength(3); // fund + debit + credit
      expect(ledger[0].type).toBe('TOPUP');
      expect(ledger[1].type).toBe('DEBIT');
      expect(ledger[2].type).toBe('CREDIT');
    });
  });

  // ═══════════════════════════════════════════════════════════
  // LAYER 2: Terms & Metering
  // ═══════════════════════════════════════════════════════════

  describe('Pricing Engine', () => {
    const engine = new PricingEngine();

    it('should evaluate FIXED pricing', () => {
      const amount = engine.simulate({
        ruleId: 'r1', name: 'Flat', primitive: 'FIXED',
        amount: 9.99, period: 'MONTHLY',
      }, 1);
      expect(amount).toBe(9.99);
    });

    it('should evaluate UNIT_RATE pricing', () => {
      const amount = engine.simulate({
        ruleId: 'r1', name: 'Per-token', primitive: 'UNIT_RATE',
        rate: 0.00003, unit: 'TOKEN',
      }, 1000);
      expect(amount).toBe(0.03);
    });

    it('should evaluate TIERED graduated pricing', () => {
      const amount = engine.simulate({
        ruleId: 'r1', name: 'Tiered', primitive: 'TIERED',
        mode: 'GRADUATED',
        tiers: [
          { from: 0, to: 100, rate: 0.10 },
          { from: 100, to: 1000, rate: 0.05 },
          { from: 1000, to: null, rate: 0.01 },
        ],
      }, 500);
      // First 100 at $0.10 = $10, next 400 at $0.05 = $20 → $30
      expect(amount).toBe(30);
    });

    it('should evaluate PERCENTAGE with min/max', () => {
      const amount = engine.simulate({
        ruleId: 'r1', name: 'Commission', primitive: 'PERCENTAGE',
        percentage: 0.10, referenceField: 'transaction_amount',
        min: 1.00, max: 50.00,
      }, 1, { transaction_amount: 5 });
      // 10% of $5 = $0.50, but min is $1.00
      expect(amount).toBe(1);
    });

    it('should evaluate COMPOSITE (ADD) — hybrid pricing', () => {
      const amount = engine.simulate({
        ruleId: 'r1', name: 'Hybrid', primitive: 'COMPOSITE',
        operator: 'ADD',
        rules: [
          { ruleId: 'r2', name: 'Base', primitive: 'FIXED', amount: 10, period: 'MONTHLY' },
          { ruleId: 'r3', name: 'Usage', primitive: 'UNIT_RATE', rate: 0.05, unit: 'CALL' },
        ],
      }, 100);
      // $10 fixed + 100 × $0.05 = $15
      expect(amount).toBe(15);
    });

    it('should use PricingTemplates.perToken', () => {
      const rule = PricingTemplates.perToken(30, 60); // $30/M input, $60/M output
      const inputCost = engine.simulate(rule, 1_000_000, { direction: 'input' });
      const outputCost = engine.simulate(rule, 1_000_000, { direction: 'output' });
      expect(inputCost).toBe(30);
      expect(outputCost).toBe(60);
    });

    it('should explain pricing calculations', () => {
      const rule = PricingTemplates.subscriptionPlusUsage(99, 1000, 0.05);
      const explanation = engine.explain(rule, {
        event: {
          eventId: 'e1', sourceAgentId: 's', targetAgentId: 't',
          contractId: 'c', serviceId: 'svc', timestamp: new Date(),
          quantity: 1500, unit: 'CALL', dimensions: {},
        },
      });
      expect(explanation).toContain('COMPOSITE');
      expect(explanation).toContain('FIXED');
      expect(explanation).toContain('THRESHOLD');
    });
  });

  describe('Contracts', () => {
    it('should create and find active contracts', () => {
      const agent1 = ump.agents.create({
        name: 'buyer', type: 'AI_AGENT',
        authority: { maxPerTransaction: 100, maxPerDay: 1000 },
      });
      const agent2 = ump.agents.create({
        name: 'seller', type: 'SERVICE',
        authority: { maxPerTransaction: 100, maxPerDay: 1000 },
      });

      const contract = ump.contracts.create(agent1.agentId, {
        targetAgentId: agent2.agentId,
        pricingRules: [{
          ruleId: 'r1', name: 'Per-call', primitive: 'UNIT_RATE',
          rate: 0.01, unit: 'API_CALL',
        }],
      });

      expect(contract.status).toBe('ACTIVE');

      const found = ump.contracts.findActive(agent1.agentId, agent2.agentId);
      expect(found?.contractId).toBe(contract.contractId);
    });

    it('should support dynamic negotiation flow', () => {
      const a1 = ump.agents.create({
        name: 'a1', type: 'AI_AGENT',
        authority: { maxPerTransaction: 100, maxPerDay: 1000 },
      });
      const a2 = ump.agents.create({
        name: 'a2', type: 'AI_AGENT',
        authority: { maxPerTransaction: 100, maxPerDay: 1000 },
      });

      // a1 proposes
      const proposal = ump.contracts.propose(a1.agentId, {
        targetAgentId: a2.agentId,
        pricingRules: [{
          name: 'Per-file', primitive: 'UNIT_RATE', rate: 0.50, unit: 'FILE',
        } as any],
      });
      expect(proposal.status).toBe('PROPOSED');

      // a2 counters
      const counter = ump.contracts.counter(proposal.contractId, a2.agentId, [{
        name: 'Per-file', primitive: 'UNIT_RATE', rate: 0.35, unit: 'FILE',
      } as any]);
      expect(counter.status).toBe('PROPOSED');
      expect(counter.metadata).toHaveProperty('counterTo');

      // a1 accepts
      const accepted = ump.contracts.accept(counter.contractId);
      expect(accepted.status).toBe('ACTIVE');
    });
  });

  describe('Metering', () => {
    it('should record usage events idempotently', () => {
      const e1 = ump.metering.record({
        eventId: 'evt_dedup_test',
        sourceAgentId: 's1', targetAgentId: 't1',
        contractId: 'c1', serviceId: 'svc1',
        quantity: 100, unit: 'TOKEN', dimensions: {},
      });

      // Resubmit same ID → should return original
      const e2 = ump.metering.record({
        eventId: 'evt_dedup_test',
        sourceAgentId: 's1', targetAgentId: 't1',
        contractId: 'c1', serviceId: 'svc1',
        quantity: 999, unit: 'TOKEN', dimensions: {},
      });

      expect(e2.quantity).toBe(100); // original, not 999
      expect(e1.eventId).toBe(e2.eventId);
    });
  });

  // ═══════════════════════════════════════════════════════════
  // LAYER 3: Settlement & Governance
  // ═══════════════════════════════════════════════════════════

  describe('Settlement Bus', () => {
    it('should execute instant drawdown settlement', () => {
      const buyer = ump.registerAgent({
        name: 'buyer', type: 'AI_AGENT',
        authority: { maxPerTransaction: 100, maxPerDay: 1000 },
      });
      const seller = ump.registerAgent({
        name: 'seller', type: 'SERVICE',
        authority: { maxPerTransaction: 100, maxPerDay: 1000 },
      });

      buyer.wallet.fund({ amount: 100 });

      const result = ump.settlement.settleInstant(
        buyer.id, seller.id,
        [{
          ratedRecordId: 'r1', usageEventId: 'e1', contractId: 'c1',
          pricingRuleId: 'p1', quantity: 1000, rate: 0.00003,
          amount: 0.03, currency: 'USD', ratedAt: new Date(),
        }],
      );

      expect(result.settlement.status).toBe('SETTLED');
      expect(result.settlement.totalAmount).toBe(0.03);
      expect(buyer.wallet.balance()).toBe(99.97);
      expect(seller.wallet.balance()).toBe(0.03);
    });

    it('should execute escrow → release flow', () => {
      const buyer = ump.registerAgent({
        name: 'buyer', type: 'AI_AGENT',
        authority: { maxPerTransaction: 100, maxPerDay: 1000 },
      });
      const seller = ump.registerAgent({
        name: 'seller', type: 'SERVICE',
        authority: { maxPerTransaction: 100, maxPerDay: 1000 },
      });

      buyer.wallet.fund({ amount: 100 });

      // Create escrow
      const escrowId = ump.settlement.createEscrow(buyer.id, seller.id, 50, 'txn_1');

      // Buyer's available should be reduced, but total still shows reserved
      expect(buyer.wallet.balance()).toBe(50); // 100 - 50 reserved

      // Release escrow (simulate outcome verified)
      const result = ump.settlement.releaseEscrow(escrowId, 47); // partial: 47 of 50

      expect(result.settlement.totalAmount).toBe(47);
      expect(seller.wallet.balance()).toBe(47);
    });

    it('should execute waterfall splits', () => {
      const buyer = ump.registerAgent({
        name: 'buyer', type: 'AI_AGENT',
        authority: { maxPerTransaction: 200, maxPerDay: 2000 },
      });
      const platform = ump.registerAgent({
        name: 'platform', type: 'SERVICE',
        authority: { maxPerTransaction: 200, maxPerDay: 2000 },
      });
      const vendor = ump.registerAgent({
        name: 'vendor', type: 'SERVICE',
        authority: { maxPerTransaction: 200, maxPerDay: 2000 },
      });

      buyer.wallet.fund({ amount: 100 });

      const results = ump.settlement.settleWaterfall(
        buyer.id,
        [
          { agentId: platform.id, amount: 15 }, // 15% commission
          { agentId: vendor.id, amount: 85 },   // 85% to vendor
        ],
        [],
      );

      expect(results).toHaveLength(2);
      expect(buyer.wallet.balance()).toBe(0);
      expect(platform.wallet.balance()).toBe(15);
      expect(vendor.wallet.balance()).toBe(85);
    });
  });

  describe('Audit Trail', () => {
    it('should record and query audit entries', () => {
      const auditId = ump.audit.record({
        what: { operation: 'TEST', entityType: 'test', entityId: 'e1', amount: 42 },
        who: { sourceAgentId: 'a1', targetAgentId: 'a2' },
        why: { contractId: 'c1', justification: 'Test audit' },
        how: { policiesEvaluated: ['SPENDING_LIMIT'], policiesPassed: ['SPENDING_LIMIT'] },
        result: { status: 'SUCCESS' },
      });

      expect(auditId).toMatch(/^aud_/);

      const records = ump.audit.query({ agentId: 'a1' });
      expect(records.length).toBeGreaterThan(0);
      expect(records[0].what.operation).toBe('TEST');
    });

    it('should fire onAudit callback', () => {
      const captured: any[] = [];
      const ump2 = new UMP({
        apiKey: 'test',
        onAudit: (record) => captured.push(record),
      });

      ump2.audit.record({
        what: { operation: 'CB_TEST', entityType: 'test', entityId: 'e1' },
        who: { sourceAgentId: 'a1', targetAgentId: 'a2' },
        why: {},
        how: { policiesEvaluated: [], policiesPassed: [] },
        result: { status: 'OK' },
      });

      expect(captured).toHaveLength(1);
      expect(captured[0].what.operation).toBe('CB_TEST');
    });
  });

  // ═══════════════════════════════════════════════════════════
  // END-TO-END: The 10-Line Quick Start
  // ═══════════════════════════════════════════════════════════

  describe('End-to-End Transaction', () => {
    it('should execute the Quick Start flow', async () => {
      // 1. Initialize
      const ump = new UMP({ apiKey: 'ump_sk_test' });

      // 2. Register agents
      const buyer = ump.registerAgent({
        name: 'my-coding-agent',
        type: 'AI_AGENT',
        authority: { maxPerTransaction: '$50', maxPerDay: '$500' },
      });

      const seller = ump.registerAgent({
        name: 'code-review-service',
        type: 'SERVICE',
        authority: { maxPerTransaction: '$100', maxPerDay: '$5000' },
      });

      // 3. Fund the wallet
      buyer.wallet.fund({ amount: '$100' });

      // 4. Create contract
      ump.contracts.create(buyer.id, {
        targetAgentId: seller.id,
        pricingRules: [{
          ruleId: 'default',
          name: 'Per code review',
          primitive: 'FIXED',
          amount: 0.12,
          period: 'PER_EVENT',
        }],
      });

      // 5. Transact!
      const result = await ump.transact({
        from: buyer.id,
        to: seller.id,
        service: 'code_review',
        payload: { repo: 'github.com/acme/app', pr: 42 },
      });

      expect(result.cost).toBe(0.12);
      expect(result.auditId).toMatch(/^aud_/);
      expect(result.duration).toBeLessThan(1000); // sub-second
      expect(buyer.wallet.balance()).toBe(99.88);
      expect(seller.wallet.balance()).toBe(0.12);
    });
  });
});
