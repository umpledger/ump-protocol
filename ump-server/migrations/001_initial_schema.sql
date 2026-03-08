-- ═══════════════════════════════════════════════════════════════
-- UMP v2.0 — PostgreSQL Schema
-- The persistence layer for the Universal Monetization Protocol
-- ═══════════════════════════════════════════════════════════════

-- Enable extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ── ENUMS ─────────────────────────────────────────────────────

CREATE TYPE agent_type AS ENUM (
  'HUMAN', 'ORGANIZATION', 'AI_AGENT', 'SERVICE', 'COMPOSITE'
);

CREATE TYPE agent_status AS ENUM (
  'ACTIVE', 'SUSPENDED', 'REVOKED', 'EXPIRED'
);

CREATE TYPE value_unit_type AS ENUM (
  'FIAT', 'AI_TOKEN', 'COMPUTE_CREDIT', 'OUTCOME_SCORE',
  'PLATFORM_CREDIT', 'ENVIRONMENTAL'
);

CREATE TYPE ledger_entry_type AS ENUM (
  'DEBIT', 'CREDIT', 'RESERVE', 'RELEASE', 'TOPUP'
);

CREATE TYPE contract_mode AS ENUM (
  'PRE_NEGOTIATED', 'TEMPLATE', 'DYNAMIC'
);

CREATE TYPE contract_status AS ENUM (
  'DRAFT', 'PROPOSED', 'ACTIVE', 'EXPIRED', 'TERMINATED'
);

CREATE TYPE settlement_pattern AS ENUM (
  'INSTANT_DRAWDOWN', 'ESCROW_RELEASE', 'WATERFALL_SPLIT',
  'NET_SETTLEMENT', 'CONDITIONAL_RELEASE', 'CROSS_CURRENCY_ATOMIC'
);

CREATE TYPE settlement_status AS ENUM (
  'PENDING', 'PROCESSING', 'SETTLED', 'FAILED', 'REVERSED'
);

CREATE TYPE dispute_stage AS ENUM (
  'AUTOMATED_RECONCILIATION', 'AGENT_NEGOTIATION',
  'ARBITRATION_ORACLE', 'HUMAN_ESCALATION'
);

CREATE TYPE dispute_status AS ENUM (
  'OPEN', 'IN_PROGRESS', 'RESOLVED', 'ESCALATED', 'CLOSED'
);

CREATE TYPE policy_type AS ENUM (
  'SPENDING_LIMIT', 'COUNTERPARTY_ALLOWLIST', 'SERVICE_ALLOWLIST',
  'RATE_REASONABLENESS', 'OUTCOME_VERIFICATION', 'COMPLIANCE',
  'ANOMALY_DETECTION', 'BUDGET_ALLOCATION'
);

CREATE TYPE violation_action AS ENUM (
  'HARD_BLOCK', 'SOFT_BLOCK', 'ALERT', 'LOG'
);

-- ═══════════════════════════════════════════════════════════════
-- LAYER 1: Identity & Value
-- ═══════════════════════════════════════════════════════════════

-- ── API Keys ──────────────────────────────────────────────────

CREATE TABLE api_keys (
  key_id        UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  key_hash      TEXT NOT NULL UNIQUE,  -- bcrypt hash of the actual key
  key_prefix    VARCHAR(12) NOT NULL,  -- "ump_sk_abc" for display
  owner_id      UUID,                  -- references org or human agent
  name          VARCHAR(255) NOT NULL,
  permissions   JSONB NOT NULL DEFAULT '["*"]',
  rate_limit    INTEGER DEFAULT 1000,  -- per minute
  active        BOOLEAN NOT NULL DEFAULT true,
  last_used_at  TIMESTAMPTZ,
  expires_at    TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_api_keys_hash ON api_keys(key_hash);
CREATE INDEX idx_api_keys_owner ON api_keys(owner_id);

-- ── Agent Identities ──────────────────────────────────────────

CREATE TABLE agents (
  agent_id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  agent_type        agent_type NOT NULL,
  parent_id         UUID REFERENCES agents(agent_id) ON DELETE SET NULL,
  display_name      VARCHAR(255) NOT NULL,
  capabilities      TEXT[] DEFAULT '{}',

  -- Authority Scope (embedded)
  max_per_txn       NUMERIC(20,4) NOT NULL,
  max_per_day       NUMERIC(20,4) NOT NULL,
  max_per_month     NUMERIC(20,4) NOT NULL,
  allowed_services  TEXT[],
  allowed_counterparties TEXT[],
  requires_approval_above NUMERIC(20,4),
  auto_revoke_after INTERVAL,

  -- Verification
  public_key        TEXT,
  issuing_authority VARCHAR(255) DEFAULT 'ump-server',
  verification_expires_at TIMESTAMPTZ,

  -- Metadata
  metadata          JSONB DEFAULT '{}',
  status            agent_status NOT NULL DEFAULT 'ACTIVE',

  -- Spending tracking (denormalized for fast checks)
  spent_today       NUMERIC(20,4) NOT NULL DEFAULT 0,
  spent_this_month  NUMERIC(20,4) NOT NULL DEFAULT 0,
  spending_reset_day DATE NOT NULL DEFAULT CURRENT_DATE,
  spending_reset_month DATE NOT NULL DEFAULT DATE_TRUNC('month', CURRENT_DATE),

  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_agents_parent ON agents(parent_id);
CREATE INDEX idx_agents_status ON agents(status);
CREATE INDEX idx_agents_type ON agents(agent_type);

-- ── Wallets ───────────────────────────────────────────────────

CREATE TABLE wallets (
  wallet_id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  owner_agent_id    UUID NOT NULL REFERENCES agents(agent_id),
  frozen            BOOLEAN NOT NULL DEFAULT false,

  -- Funding source config
  funding_type      VARCHAR(50),  -- 'LINKED_BANK', 'PARENT_DRAWDOWN', 'PREPAID'
  funding_source_id VARCHAR(255),
  auto_topup_threshold NUMERIC(20,4),
  auto_topup_amount    NUMERIC(20,4),

  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT unique_owner_wallet UNIQUE(owner_agent_id)
);

CREATE INDEX idx_wallets_owner ON wallets(owner_agent_id);

-- ── Balances ──────────────────────────────────────────────────
-- Separate table: one row per wallet per value-unit-type per currency

CREATE TABLE balances (
  balance_id        UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  wallet_id         UUID NOT NULL REFERENCES wallets(wallet_id),
  value_unit_type   value_unit_type NOT NULL DEFAULT 'FIAT',
  currency          VARCHAR(10) DEFAULT 'USD',
  amount            NUMERIC(20,6) NOT NULL DEFAULT 0,
  reserved          NUMERIC(20,6) NOT NULL DEFAULT 0,
  available         NUMERIC(20,6) NOT NULL DEFAULT 0,  -- = amount - reserved
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT unique_wallet_vut_currency UNIQUE(wallet_id, value_unit_type, currency),
  CONSTRAINT check_available CHECK (available >= 0),
  CONSTRAINT check_reserved CHECK (reserved >= 0)
);

CREATE INDEX idx_balances_wallet ON balances(wallet_id);

-- ── Spending Ledger ───────────────────────────────────────────
-- Immutable append-only log. NEVER UPDATE or DELETE rows.

CREATE TABLE ledger_entries (
  entry_id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  wallet_id         UUID NOT NULL REFERENCES wallets(wallet_id),
  entry_type        ledger_entry_type NOT NULL,
  amount            NUMERIC(20,6) NOT NULL,
  value_unit_type   value_unit_type NOT NULL DEFAULT 'FIAT',
  currency          VARCHAR(10) DEFAULT 'USD',
  counterparty_agent_id UUID REFERENCES agents(agent_id),
  transaction_id    UUID,
  description       TEXT NOT NULL,
  balance_after     NUMERIC(20,6) NOT NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Immutability: no UPDATE or DELETE triggers
CREATE INDEX idx_ledger_wallet ON ledger_entries(wallet_id);
CREATE INDEX idx_ledger_txn ON ledger_entries(transaction_id);
CREATE INDEX idx_ledger_created ON ledger_entries(created_at);

-- Partition by month for performance at scale
-- (commented out for initial deployment; enable when volume warrants)
-- CREATE TABLE ledger_entries_2026_01 PARTITION OF ledger_entries
--   FOR VALUES FROM ('2026-01-01') TO ('2026-02-01');

-- ═══════════════════════════════════════════════════════════════
-- LAYER 2: Terms & Metering
-- ═══════════════════════════════════════════════════════════════

-- ── Contracts ─────────────────────────────────────────────────

CREATE TABLE contracts (
  contract_id       UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  mode              contract_mode NOT NULL DEFAULT 'TEMPLATE',
  status            contract_status NOT NULL DEFAULT 'DRAFT',
  source_agent_id   UUID NOT NULL REFERENCES agents(agent_id),
  target_agent_id   UUID NOT NULL REFERENCES agents(agent_id),
  pricing_rules     JSONB NOT NULL,  -- Array of PricingRule objects
  effective_from    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  effective_until   TIMESTAMPTZ,
  metadata          JSONB DEFAULT '{}',
  counter_to        UUID REFERENCES contracts(contract_id),  -- for negotiation chain
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_contracts_source ON contracts(source_agent_id);
CREATE INDEX idx_contracts_target ON contracts(target_agent_id);
CREATE INDEX idx_contracts_status ON contracts(status);
CREATE INDEX idx_contracts_active ON contracts(source_agent_id, target_agent_id, status)
  WHERE status = 'ACTIVE';

-- ── Usage Events ──────────────────────────────────────────────
-- High-volume table. Designed for time-series partitioning.

CREATE TABLE usage_events (
  event_id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  source_agent_id   UUID NOT NULL REFERENCES agents(agent_id),
  target_agent_id   UUID NOT NULL REFERENCES agents(agent_id),
  contract_id       UUID NOT NULL REFERENCES contracts(contract_id),
  service_id        VARCHAR(255) NOT NULL,
  quantity          NUMERIC(20,6) NOT NULL,
  unit              VARCHAR(50) NOT NULL,
  dimensions        JSONB DEFAULT '{}',
  outcome_id        UUID,  -- references outcome_attestations
  source_signature  TEXT,
  target_signature  TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_usage_contract ON usage_events(contract_id);
CREATE INDEX idx_usage_source ON usage_events(source_agent_id);
CREATE INDEX idx_usage_target ON usage_events(target_agent_id);
CREATE INDEX idx_usage_created ON usage_events(created_at);
-- Idempotency index
CREATE UNIQUE INDEX idx_usage_idempotent ON usage_events(event_id);

-- ── Outcome Attestations ──────────────────────────────────────

CREATE TABLE outcome_attestations (
  outcome_id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  outcome_type        VARCHAR(50) NOT NULL,
  claimed_by          UUID NOT NULL REFERENCES agents(agent_id),
  evidence            JSONB NOT NULL DEFAULT '[]',
  verification_method VARCHAR(50) NOT NULL,
  verified_by         UUID REFERENCES agents(agent_id),
  confidence_score    NUMERIC(3,2) NOT NULL CHECK (confidence_score BETWEEN 0 AND 1),
  attestation_status  VARCHAR(20) NOT NULL DEFAULT 'CLAIMED',
  dispute_window      INTERVAL NOT NULL DEFAULT '24 hours',
  expires_at          TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_outcomes_claimed_by ON outcome_attestations(claimed_by);
CREATE INDEX idx_outcomes_status ON outcome_attestations(attestation_status);

-- ── Rated Records ─────────────────────────────────────────────

CREATE TABLE rated_records (
  rated_record_id   UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  usage_event_id    UUID NOT NULL REFERENCES usage_events(event_id),
  contract_id       UUID NOT NULL REFERENCES contracts(contract_id),
  pricing_rule_id   VARCHAR(255) NOT NULL,
  quantity          NUMERIC(20,6) NOT NULL,
  rate              NUMERIC(20,8) NOT NULL,
  amount            NUMERIC(20,6) NOT NULL,
  currency          VARCHAR(10) NOT NULL DEFAULT 'USD',
  settlement_id     UUID,  -- populated when settled
  rated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_rated_event ON rated_records(usage_event_id);
CREATE INDEX idx_rated_settlement ON rated_records(settlement_id);

-- ═══════════════════════════════════════════════════════════════
-- LAYER 3: Settlement & Governance
-- ═══════════════════════════════════════════════════════════════

-- ── Settlements ───────────────────────────────────────────────

CREATE TABLE settlements (
  settlement_id     UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  pattern           settlement_pattern NOT NULL,
  status            settlement_status NOT NULL DEFAULT 'PENDING',
  source_agent_id   UUID NOT NULL REFERENCES agents(agent_id),
  target_agent_id   UUID NOT NULL REFERENCES agents(agent_id),
  total_amount      NUMERIC(20,6) NOT NULL,
  currency          VARCHAR(10) NOT NULL DEFAULT 'USD',
  audit_id          UUID,
  settled_at        TIMESTAMPTZ,
  failed_reason     TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_settlements_source ON settlements(source_agent_id);
CREATE INDEX idx_settlements_target ON settlements(target_agent_id);
CREATE INDEX idx_settlements_status ON settlements(status);

-- ── Escrows ───────────────────────────────────────────────────

CREATE TABLE escrows (
  escrow_id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  source_wallet_id  UUID NOT NULL REFERENCES wallets(wallet_id),
  target_wallet_id  UUID NOT NULL REFERENCES wallets(wallet_id),
  amount            NUMERIC(20,6) NOT NULL,
  remaining         NUMERIC(20,6) NOT NULL,
  transaction_id    UUID,
  status            VARCHAR(20) NOT NULL DEFAULT 'HELD',  -- HELD, RELEASED, RETURNED
  released_at       TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_escrows_source ON escrows(source_wallet_id);
CREATE INDEX idx_escrows_status ON escrows(status);

-- ── Audit Trail ───────────────────────────────────────────────
-- Immutable. NEVER UPDATE or DELETE.

CREATE TABLE audit_trail (
  audit_id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

  -- WHAT
  operation         VARCHAR(100) NOT NULL,
  entity_type       VARCHAR(50) NOT NULL,
  entity_id         UUID,
  amount            NUMERIC(20,6),

  -- WHO
  source_agent_id   UUID REFERENCES agents(agent_id),
  target_agent_id   UUID REFERENCES agents(agent_id),
  human_owner_id    UUID,

  -- WHY
  contract_id       UUID REFERENCES contracts(contract_id),
  pricing_rule_id   VARCHAR(255),
  justification     TEXT,

  -- HOW
  policies_evaluated TEXT[] DEFAULT '{}',
  policies_passed    TEXT[] DEFAULT '{}',
  overrides          TEXT[] DEFAULT '{}',

  -- RESULT
  balance_before    NUMERIC(20,6),
  balance_after     NUMERIC(20,6),
  settlement_amount NUMERIC(20,6),
  result_status     VARCHAR(50) NOT NULL,

  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_audit_source ON audit_trail(source_agent_id);
CREATE INDEX idx_audit_target ON audit_trail(target_agent_id);
CREATE INDEX idx_audit_operation ON audit_trail(operation);
CREATE INDEX idx_audit_created ON audit_trail(created_at);
CREATE INDEX idx_audit_contract ON audit_trail(contract_id);
CREATE INDEX idx_audit_amount ON audit_trail(amount) WHERE amount IS NOT NULL;

-- ── Disputes ──────────────────────────────────────────────────

CREATE TABLE disputes (
  dispute_id        UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  transaction_id    UUID,
  settlement_id     UUID REFERENCES settlements(settlement_id),
  opened_by         UUID NOT NULL REFERENCES agents(agent_id),
  respondent        UUID NOT NULL REFERENCES agents(agent_id),
  stage             dispute_stage NOT NULL DEFAULT 'AUTOMATED_RECONCILIATION',
  status            dispute_status NOT NULL DEFAULT 'OPEN',
  reason            TEXT NOT NULL,
  evidence          JSONB DEFAULT '[]',
  amount            NUMERIC(20,6) NOT NULL,
  resolution_outcome VARCHAR(20),  -- UPHELD, REJECTED, PARTIAL
  resolution_amount  NUMERIC(20,6),
  opened_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at       TIMESTAMPTZ,
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_disputes_opened_by ON disputes(opened_by);
CREATE INDEX idx_disputes_status ON disputes(status);
CREATE INDEX idx_disputes_stage ON disputes(stage);

-- ── Policies ──────────────────────────────────────────────────

CREATE TABLE policies (
  policy_id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  policy_type       policy_type NOT NULL,
  agent_id          UUID NOT NULL REFERENCES agents(agent_id),
  config            JSONB NOT NULL,
  violation_action  violation_action NOT NULL DEFAULT 'HARD_BLOCK',
  enabled           BOOLEAN NOT NULL DEFAULT true,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_policies_agent ON policies(agent_id);
CREATE INDEX idx_policies_type ON policies(policy_type);
CREATE INDEX idx_policies_active ON policies(agent_id, policy_type) WHERE enabled = true;

-- ═══════════════════════════════════════════════════════════════
-- FUNCTIONS & TRIGGERS
-- ═══════════════════════════════════════════════════════════════

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply to mutable tables
CREATE TRIGGER trg_agents_updated BEFORE UPDATE ON agents
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_wallets_updated BEFORE UPDATE ON wallets
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_contracts_updated BEFORE UPDATE ON contracts
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_outcomes_updated BEFORE UPDATE ON outcome_attestations
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_disputes_updated BEFORE UPDATE ON disputes
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_policies_updated BEFORE UPDATE ON policies
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Prevent mutations on immutable tables
CREATE OR REPLACE FUNCTION prevent_mutation()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'Mutations not allowed on immutable table %', TG_TABLE_NAME;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_ledger_immutable BEFORE UPDATE OR DELETE ON ledger_entries
  FOR EACH ROW EXECUTE FUNCTION prevent_mutation();
CREATE TRIGGER trg_audit_immutable BEFORE UPDATE OR DELETE ON audit_trail
  FOR EACH ROW EXECUTE FUNCTION prevent_mutation();

-- Reset daily spending at midnight
CREATE OR REPLACE FUNCTION reset_daily_spending()
RETURNS void AS $$
BEGIN
  UPDATE agents
  SET spent_today = 0, spending_reset_day = CURRENT_DATE
  WHERE spending_reset_day < CURRENT_DATE AND status = 'ACTIVE';
END;
$$ LANGUAGE plpgsql;

-- Reset monthly spending
CREATE OR REPLACE FUNCTION reset_monthly_spending()
RETURNS void AS $$
BEGIN
  UPDATE agents
  SET spent_this_month = 0,
      spending_reset_month = DATE_TRUNC('month', CURRENT_DATE)
  WHERE spending_reset_month < DATE_TRUNC('month', CURRENT_DATE)
    AND status = 'ACTIVE';
END;
$$ LANGUAGE plpgsql;

-- Balance consistency: ensure available = amount - reserved
CREATE OR REPLACE FUNCTION enforce_balance_consistency()
RETURNS TRIGGER AS $$
BEGIN
  NEW.available = NEW.amount - NEW.reserved;
  IF NEW.available < 0 THEN
    RAISE EXCEPTION 'Insufficient funds: available would be %', NEW.available;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_balance_consistency BEFORE INSERT OR UPDATE ON balances
  FOR EACH ROW EXECUTE FUNCTION enforce_balance_consistency();

-- ═══════════════════════════════════════════════════════════════
-- VIEWS (for common queries)
-- ═══════════════════════════════════════════════════════════════

-- Agent spending dashboard
CREATE VIEW v_agent_spending AS
SELECT
  a.agent_id,
  a.display_name,
  a.agent_type,
  a.max_per_day,
  a.max_per_month,
  a.spent_today,
  a.spent_this_month,
  ROUND((a.spent_today / NULLIF(a.max_per_day, 0)) * 100, 1) AS daily_pct_used,
  ROUND((a.spent_this_month / NULLIF(a.max_per_month, 0)) * 100, 1) AS monthly_pct_used,
  b.available AS wallet_balance,
  b.currency
FROM agents a
LEFT JOIN wallets w ON w.owner_agent_id = a.agent_id
LEFT JOIN balances b ON b.wallet_id = w.wallet_id AND b.value_unit_type = 'FIAT'
WHERE a.status = 'ACTIVE';

-- Transaction volume summary
CREATE VIEW v_transaction_volume AS
SELECT
  DATE_TRUNC('hour', s.created_at) AS hour,
  COUNT(*) AS txn_count,
  SUM(s.total_amount) AS total_volume,
  AVG(s.total_amount) AS avg_txn_size,
  s.currency
FROM settlements s
WHERE s.status = 'SETTLED'
GROUP BY DATE_TRUNC('hour', s.created_at), s.currency
ORDER BY hour DESC;

-- ═══════════════════════════════════════════════════════════════
-- GRANTS (example for app user)
-- ═══════════════════════════════════════════════════════════════

-- CREATE ROLE ump_app WITH LOGIN PASSWORD 'changeme';
-- GRANT SELECT, INSERT ON ALL TABLES IN SCHEMA public TO ump_app;
-- GRANT UPDATE ON agents, wallets, balances, contracts, outcome_attestations, disputes, policies, api_keys TO ump_app;
-- REVOKE UPDATE, DELETE ON ledger_entries, audit_trail FROM ump_app;
