/**
 * UMP v2.0 — Quick Start Example
 *
 * This example demonstrates the core flow:
 * Register agents → Fund wallets → Create contracts → Transact
 *
 * Run: npx tsx examples/quickstart.ts
 */
import { UMP, PricingTemplates } from '../src';

async function main() {
  // ── 1. Initialize UMP ──
  const ump = new UMP({
    apiKey: 'ump_sk_demo_123',
    onAudit: (record) => {
      console.log(`[AUDIT] ${record.what.operation}: $${record.what.amount ?? 0}`);
    },
  });

  // ── 2. Register your AI agent with spending limits ──
  const codingAgent = ump.registerAgent({
    name: 'my-coding-agent',
    type: 'AI_AGENT',
    capabilities: ['code_review', 'refactoring', 'testing'],
    authority: {
      maxPerTransaction: '$50',
      maxPerDay: '$500',
      maxPerMonth: '$5000',
    },
  });

  console.log(`✓ Registered agent: ${codingAgent.id}`);

  // ── 3. Register the service agent ──
  const reviewService = ump.registerAgent({
    name: 'code-review-service',
    type: 'SERVICE',
    capabilities: ['security_review', 'performance_review'],
    authority: {
      maxPerTransaction: '$100',
      maxPerDay: '$10000',
    },
  });

  console.log(`✓ Registered service: ${reviewService.id}`);

  // ── 4. Fund the agent's wallet ──
  codingAgent.wallet.fund({ amount: '$100' });
  console.log(`✓ Funded wallet: $${codingAgent.wallet.balance()}`);

  // ── 5. Create a contract with pricing rules ──
  const contract = ump.contracts.create(codingAgent.id, {
    targetAgentId: reviewService.id,
    pricingRules: [
      PricingTemplates.agentTask(0.50, 1.00), // $0.50/task + $1.00 bonus on success
    ],
  });

  console.log(`✓ Contract created: ${contract.contractId}`);

  // ── 6. Execute a transaction ──
  const result = await ump.transact({
    from: codingAgent.id,
    to: reviewService.id,
    service: 'code_review',
    payload: {
      repo: 'github.com/acme/app',
      pr: 42,
      files: ['src/auth.ts', 'src/payments.ts'],
    },
  });

  console.log(`\n═══ Transaction Result ═══`);
  console.log(`  Cost:    $${result.cost}`);
  console.log(`  Audit:   ${result.auditId}`);
  console.log(`  Speed:   ${result.duration}ms`);
  console.log(`  Balance: $${codingAgent.wallet.balance()}`);

  // ── 7. Check the ledger ──
  const wallet = ump.wallets.getByAgent(codingAgent.id);
  const ledger = ump.wallets.getLedger(wallet.walletId);
  console.log(`\n═══ Spending Ledger (${ledger.length} entries) ═══`);
  for (const entry of ledger) {
    console.log(`  ${entry.type.padEnd(8)} $${entry.amount.toFixed(2).padStart(8)}  ${entry.description}`);
  }

  // ── 8. Simulate pricing scenarios ──
  const perTokenRule = PricingTemplates.perToken(30, 60);
  console.log(`\n═══ Pricing Simulation ═══`);
  console.log(`  1M input tokens:  $${ump.pricing.simulate(perTokenRule, 1_000_000, { direction: 'input' })}`);
  console.log(`  1M output tokens: $${ump.pricing.simulate(perTokenRule, 1_000_000, { direction: 'output' })}`);

  const hybridRule = PricingTemplates.subscriptionPlusUsage(99, 1000, 0.05);
  console.log(`  500 calls (sub):  $${ump.pricing.simulate(hybridRule, 500)}`);
  console.log(`  2000 calls (sub): $${ump.pricing.simulate(hybridRule, 2000)}`);

  // ── 9. Query audit trail ──
  const audits = ump.audit.query({ agentId: codingAgent.id });
  console.log(`\n═══ Audit Trail (${audits.length} records) ═══`);
  for (const a of audits) {
    console.log(`  [${a.when.toISOString()}] ${a.what.operation} - ${a.result.status}`);
  }

  console.log(`\n✓ Done! UMP v2.0 Quick Start complete.`);
}

main().catch(console.error);
