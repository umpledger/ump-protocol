/**
 * UMP v2.0 — Multi-Agent Marketplace Example
 *
 * Demonstrates the AI Agent API Marketplace use case from the spec:
 * A coding agent discovers a security-review agent, negotiates pricing,
 * submits work, verifies outcomes, and settles payment — all autonomously.
 *
 * Run: npx tsx examples/multi-agent-marketplace.ts
 */
import { UMP, PricingTemplates } from '../src';

async function main() {
  const ump = new UMP({
    apiKey: 'ump_sk_marketplace_demo',
    onAudit: (r) => console.log(`  [AUDIT] ${r.what.operation}: $${r.what.amount ?? 0}`),
  });

  console.log('═══ Multi-Agent Marketplace Demo ═══\n');

  // ── 1. Set up the enterprise org ──
  const acmeOrg = ump.registerAgent({
    name: 'Acme Corp',
    type: 'ORGANIZATION',
    authority: { maxPerTransaction: '$500', maxPerDay: '$5000', maxPerMonth: '$50000' },
  });
  acmeOrg.wallet.fund({ amount: '$10000' });
  console.log(`✓ Org registered: ${acmeOrg.id} (balance: $${acmeOrg.wallet.balance()})`);

  // ── 2. Org creates an AI coding agent ──
  const codingAgent = ump.registerAgent({
    name: 'acme-coding-agent',
    type: 'AI_AGENT',
    capabilities: ['code_generation', 'refactoring'],
    authority: {
      maxPerTransaction: '$100',
      maxPerDay: '$1000',
    },
  });
  codingAgent.wallet.fund({ amount: '$500' });

  // ── 3. Security review service registers ──
  const securityAgent = ump.registerAgent({
    name: 'security-review-service',
    type: 'SERVICE',
    capabilities: ['security_review', 'vulnerability_scan'],
    authority: {
      maxPerTransaction: '$200',
      maxPerDay: '$10000',
    },
  });
  console.log(`✓ Security service: ${securityAgent.id}`);

  // ── 4. Dynamic contract negotiation ──
  console.log('\n── Contract Negotiation ──');

  // Coding agent proposes
  const proposal = ump.contracts.propose(codingAgent.id, {
    targetAgentId: securityAgent.id,
    pricingRules: [{
      name: 'Per-file static analysis',
      primitive: 'UNIT_RATE',
      rate: 0.05,
      unit: 'FILE',
    } as any],
  });
  console.log(`  Proposal: $0.05/file (status: ${proposal.status})`);

  // Security agent counters with tiered pricing
  const counter = ump.contracts.counter(proposal.contractId, securityAgent.id, [{
    name: 'Deep review tiered',
    primitive: 'TIERED',
    mode: 'GRADUATED',
    tiers: [
      { from: 0, to: 50, rate: 0.50 },
      { from: 50, to: 200, rate: 0.35 },
      { from: 200, to: null, rate: 0.20 },
    ],
  } as any]);
  console.log(`  Counter: $0.50/file (first 50), $0.35 (50-200), $0.20 (200+) (status: ${counter.status})`);

  // Coding agent accepts
  const accepted = ump.contracts.accept(counter.contractId);
  console.log(`  ✓ Contract accepted: ${accepted.contractId}\n`);

  // ── 5. Create escrow for 94 files ──
  console.log('── Escrow & Execution ──');
  const fileCount = 94;
  const estimatedCost = 50 * 0.50 + 44 * 0.35; // $25 + $15.40 = $40.40
  console.log(`  Estimated cost for ${fileCount} files: $${estimatedCost.toFixed(2)}`);

  const escrowId = ump.settlement.createEscrow(
    codingAgent.id,
    securityAgent.id,
    estimatedCost,
    'txn_security_review_1',
  );
  console.log(`  ✓ Escrow created: ${escrowId}`);
  console.log(`  Buyer balance: $${codingAgent.wallet.balance()} (${estimatedCost} reserved)`);

  // ── 6. Simulate execution — meter per-file events ──
  for (let i = 0; i < fileCount; i++) {
    ump.metering.record({
      sourceAgentId: codingAgent.id,
      targetAgentId: securityAgent.id,
      contractId: accepted.contractId,
      serviceId: 'deep_security_review',
      quantity: 1,
      unit: 'FILE',
      dimensions: { filename: `src/file_${i}.ts`, severity_findings: Math.floor(Math.random() * 3) },
    });
  }
  console.log(`  ✓ Metered ${fileCount} file review events`);

  // ── 7. Release escrow upon verified outcome ──
  const outcome = ump.metering.attestOutcome({
    outcomeType: 'TASK_COMPLETION',
    claimedBy: securityAgent.id,
    evidence: [
      { type: 'LOG', uri: 'ump://evidence/scan_report_001', hash: 'sha256:abc123', description: '94 files reviewed' },
      { type: 'METRIC', uri: 'ump://evidence/findings_summary', hash: 'sha256:def456', description: '12 critical, 23 warnings' },
    ],
    verificationMethod: 'BILATERAL_AGREEMENT',
    confidenceScore: 0.95,
  });
  console.log(`  ✓ Outcome attested: ${outcome.outcomeId} (confidence: ${outcome.confidenceScore})`);

  const { settlement } = ump.settlement.releaseEscrow(escrowId, estimatedCost);
  console.log(`  ✓ Settlement complete: $${settlement.totalAmount.toFixed(2)} released to security agent`);

  // ── 8. Final state ──
  console.log('\n── Final State ──');
  console.log(`  Coding agent balance:  $${codingAgent.wallet.balance().toFixed(2)}`);
  console.log(`  Security agent balance: $${securityAgent.wallet.balance().toFixed(2)}`);
  console.log(`  Audit records: ${ump.audit.count()}`);
  console.log(`  Usage events: ${ump.metering.getByAgent(codingAgent.id).length}`);

  console.log('\n✓ Multi-agent marketplace demo complete!');
}

main().catch(console.error);
