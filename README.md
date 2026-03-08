# Universal Monetization Protocol (UMP)

> Open-source payment infrastructure for AI agent commerce

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Website](https://img.shields.io/badge/website-umpledger.com-black)](https://umpledger.com)
[![Version](https://img.shields.io/badge/version-2.0.0-green)](CHANGELOG.md)

UMP is a protocol that enables AI agents to autonomously transact with each other — pricing services, negotiating contracts, metering usage, and settling payments — without human intervention.

---

## Overview

As AI agents increasingly perform real economic work, they need a shared language for commerce. UMP provides that foundation: a 3-layer architecture that covers everything from identity to settlement.

```
┌─────────────────────────────────────────┐
│  L1 · Identity & Value                  │
│  Agent registration · Wallets · Keys    │
├─────────────────────────────────────────┤
│  L2 · Terms & Metering                  │
│  Contracts · Pricing · Usage events     │
├─────────────────────────────────────────┤
│  L3 · Settlement & Governance           │
│  Settlement bus · Disputes · Policies   │
└─────────────────────────────────────────┘
```

---

## Repository Structure

```
ump-protocol/
├── ump-sdk/          # TypeScript SDK — embed UMP into any agent
│   ├── src/
│   │   ├── core/     # AgentManager, WalletManager, AuditTrail
│   │   ├── pricing/  # PricingEngine (8 primitives), Templates
│   │   ├── terms/    # ContractManager, MeteringEngine
│   │   ├── settlement/ # SettlementBus
│   │   └── utils/    # Errors, ID generation
│   └── examples/     # Quickstart, multi-agent marketplace
├── ump-server/       # Fastify REST API server
│   ├── src/
│   │   └── routes/   # agents, wallets, transactions, contracts, disputes
│   └── migrations/   # PostgreSQL schema
└── schemas/          # JSON Schemas, OpenAPI 3.0 spec, CloudEvents catalog
    ├── api/          # openapi.json
    ├── events/       # 48 CloudEvents definitions
    └── primitives/   # 9 core schemas
```

---

## Quick Start

### SDK

```bash
npm install ump-sdk
```

```typescript
import { UMP } from 'ump-sdk';

const ump = new UMP();

// Register two agents
const provider = await ump.registerAgent({ name: 'DataAgent', type: 'provider' });
const consumer = await ump.registerAgent({ name: 'AnalysisAgent', type: 'consumer' });

// Fund the consumer's wallet
await ump.wallets.fund(consumer.walletId, { amount: 100, currency: 'UMP' });

// Execute a transaction
const result = await ump.transact({
  providerId: provider.id,
  consumerId: consumer.id,
  pricingRuleId: 'rule_per_token',
  usage: { tokens: 1500 },
});

console.log(result.amountCharged); // e.g. 0.003 UMP
```

### Server

```bash
cd ump-server
cp .env.example .env       # add your DATABASE_URL
npm install
npm run migrate
npm run dev
```

The server exposes a full REST API at `http://localhost:3000/ump/v2/`. See [`schemas/api/openapi.json`](schemas/api/openapi.json) for the complete spec.

---

## Pricing Primitives

UMP supports 8 composable pricing models:

| Primitive | Description | Example |
|-----------|-------------|---------|
| `FIXED` | Flat fee per call | $0.01 per request |
| `UNIT_RATE` | Price × quantity | $0.002 per 1k tokens |
| `TIERED` | Volume-based tiers | First 10k free, then $0.001 |
| `PERCENTAGE` | Take a cut | 5% of transaction value |
| `THRESHOLD` | Trigger above/below threshold | Free under 100 reqs/hr |
| `TIME_WINDOW` | Time-based pricing | Peak vs off-peak rates |
| `CONDITIONAL` | Rule-based logic | Price varies by output quality |
| `COMPOSITE` | Combine any of the above | Base + usage + commission |

---

## Settlement Modes

- **Instant drawdown** — debit wallet immediately on transaction
- **Escrow** — lock funds, release on outcome attestation
- **Waterfall** — route payments to multiple parties in sequence

---

## API Endpoints

The UMP Server exposes 41 REST endpoints across 5 resource groups:

- `POST /ump/v2/agents` — Register agent
- `POST /ump/v2/wallets/:id/fund` — Fund wallet
- `POST /ump/v2/transact` — Execute transaction
- `POST /ump/v2/contracts` — Create contract
- `POST /ump/v2/disputes` — Open dispute
- ...and 36 more — see [OpenAPI spec](schemas/api/openapi.json)

Authentication: `Authorization: Bearer ump_sk_<your_key>`

---

## Events

UMP emits 48 CloudEvents for full observability. Key events:

- `ump.agent.registered`
- `ump.transaction.completed`
- `ump.contract.accepted`
- `ump.settlement.processed`
- `ump.dispute.opened`

See [`schemas/events/event-catalog.json`](schemas/events/event-catalog.json) for the full catalog.

---

## Contributing

We welcome contributions! Please open an issue or PR. For major changes, open an issue first to discuss.

---

## License

MIT © [UMPLedger](https://umpledger.com)
