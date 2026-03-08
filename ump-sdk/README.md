# @umpledger/sdk

> The payment rail for the autonomous economy

[![npm version](https://img.shields.io/npm/v/@umpledger/sdk)](https://www.npmjs.com/package/@umpledger/sdk)
[![License: Apache-2.0](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)
[![Website](https://img.shields.io/badge/website-umpledger.com-black)](https://umpledger.com)

**Universal Monetization Protocol (UMP)** enables AI agents to autonomously price services, negotiate contracts, meter usage, and settle payments — without human intervention.

---

## Installation

```bash
npm install @umpledger/sdk
```

---

## Quick Start

```typescript
import { UMP } from '@umpledger/sdk';

const ump = new UMP({ apiKey: 'ump_sk_...' });

// Register two agents
const provider = ump.registerAgent({ name: 'DataAgent', type: 'AI_AGENT',
  authority: { maxPerTransaction: '10', maxPerDay: '1000', currency: 'USD' }
});
const consumer = ump.registerAgent({ name: 'AnalysisAgent', type: 'AI_AGENT',
  authority: { maxPerTransaction: '10', maxPerDay: '1000', currency: 'USD' }
});

// Fund the consumer wallet
consumer.wallet.fund({ amount: 100, currency: 'USD', source: 'bank_transfer' });

// Execute a transaction
const result = await ump.transact({
  from: consumer.id,
  to: provider.id,
  service: 'data_analysis',
});

console.log(`Charged: ${result.cost} ${result.currency}`);
console.log(`Audit ID: ${result.auditId}`);
```

---

## Architecture

UMP is a 3-layer protocol:

```
┌─────────────────────────────────────────┐
│  L1 · Identity & Value                  │
│  AgentManager · WalletManager           │
├─────────────────────────────────────────┤
│  L2 · Terms & Metering                  │
│  ContractManager · PricingEngine        │
│  MeteringEngine                         │
├─────────────────────────────────────────┤
│  L3 · Settlement & Governance           │
│  SettlementBus · AuditTrail             │
└─────────────────────────────────────────┘
```

---

## Core Modules

### AgentManager
Register and manage AI agents with Ed25519 keypairs and spending authority.

```typescript
const agent = ump.agents.create({
  name: 'MyAgent',
  type: 'AI_AGENT',
  authority: { maxPerTransaction: '50', maxPerDay: '500', currency: 'USD' }
});

const { valid } = ump.agents.verify(agent.agentId);
```

### WalletManager
Multi-currency wallets with reserve, debit, credit, and freeze support.

```typescript
const wallet = ump.wallets.create(agent.agentId);
ump.wallets.fund(wallet.walletId, { amount: 100, currency: 'USD', source: 'bank' });
const [balance] = ump.wallets.getBalance(wallet.walletId);
console.log(balance.available); // 100
```

### PricingEngine
Evaluate 8 composable pricing primitives:

| Primitive | Description |
|-----------|-------------|
| `FIXED` | Flat fee per call |
| `UNIT_RATE` | Price × quantity |
| `TIERED` | Volume-based tiers |
| `PERCENTAGE` | Percentage of value |
| `THRESHOLD` | Trigger above/below threshold |
| `TIME_WINDOW` | Peak vs off-peak rates |
| `CONDITIONAL` | Rule-based branching |
| `COMPOSITE` | Combine any of the above |

```typescript
const rule = PricingTemplates.perToken({ pricePerToken: 0.002, currency: 'USD' });
const result = ump.pricing.evaluate(rule, { tokens: 1500 });
console.log(result.amount); // 3.00
```

### ContractManager
Create, negotiate, and settle bilateral contracts between agents.

```typescript
const contract = ump.contracts.create(providerAgent.id, {
  targetAgentId: consumerAgent.id,
  pricingRules: [PricingTemplates.perToken({ pricePerToken: 0.001, currency: 'USD' })],
});

// Consumer accepts
ump.contracts.accept(contract.contractId, consumerAgent.id);
```

### SettlementBus
Three settlement modes — instant drawdown, escrow, and waterfall.

```typescript
// Instant settlement
const { settlement } = await ump.settlement.transact(
  consumerId, providerId, usageEvent, pricingRule
);

// Escrow: lock funds, release on outcome
const escrow = ump.settlement.escrow(consumerId, providerId, amount, currency);
ump.settlement.releaseEscrow(escrow.settlementId, consumerId, providerId);
```

### AuditTrail
Immutable append-only audit log for every operation.

```typescript
const log = ump.audit.getLog();
// Returns every transaction, contract event, and settlement
```

---

## Pricing Templates

Pre-built templates for common AI agent use cases:

```typescript
import { PricingTemplates } from '@umpledger/sdk';

PricingTemplates.perToken({ pricePerToken: 0.002, currency: 'USD' })
PricingTemplates.perInference({ pricePerCall: 0.01, currency: 'USD' })
PricingTemplates.subscriptionPlusUsage({ monthlyFee: 99, usageRate: 0.001, currency: 'USD' })
PricingTemplates.creditPool({ creditValue: 0.001, currency: 'USD' })
PricingTemplates.marketplaceCommission({ commissionRate: 0.05, currency: 'USD' })
PricingTemplates.agentTask({ pricePerTask: 5.00, currency: 'USD' })
```

---

## Error Handling

```typescript
import {
  UMPError,
  InsufficientFundsError,
  AgentRevokedError,
  AuthorityExceededError,
  ContractNotFoundError,
} from '@umpledger/sdk';

try {
  await ump.transact({ from, to, service });
} catch (err) {
  if (err instanceof InsufficientFundsError) {
    console.log('Not enough funds in wallet');
  } else if (err instanceof AuthorityExceededError) {
    console.log('Transaction exceeds agent spending authority');
  }
}
```

---

## Links

- 🌐 [umpledger.com](https://umpledger.com)
- 💻 [GitHub — umpledger/ump-protocol](https://github.com/umpledger/ump-protocol)
- 📋 [OpenAPI Spec](https://github.com/umpledger/ump-protocol/blob/main/schemas/api/openapi.json)

---

## License

Apache 2.0 © [UMPLedger](https://umpledger.com)
