// ═══════════════════════════════════════════════════════════════
// UMP v2.0 — Core Type Definitions
// The Universal Monetization Protocol type system
// ═══════════════════════════════════════════════════════════════

// ── Agent Identity Types ──────────────────────────────────────

export type AgentType = 'HUMAN' | 'ORGANIZATION' | 'AI_AGENT' | 'SERVICE' | 'COMPOSITE';
export type AgentStatus = 'ACTIVE' | 'SUSPENDED' | 'REVOKED' | 'EXPIRED';

export interface AuthorityScope {
  maxPerTransaction: number;
  maxPerDay: number;
  maxPerMonth: number;
  allowedServices?: string[];
  allowedCounterparties?: string[];
  requiresApprovalAbove?: number;
  autoRevokeAfter?: number; // ms
}

export interface VerificationProof {
  publicKey: string;
  issuingAuthority: string;
  expiresAt: Date;
  revocationEndpoint?: string;
}

export interface AgentIdentity {
  agentId: string;
  agentType: AgentType;
  parentId: string | null;
  displayName: string;
  capabilities: string[];
  authorityScope: AuthorityScope;
  verification: VerificationProof;
  metadata: Record<string, unknown>;
  status: AgentStatus;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateAgentOptions {
  name: string;
  type: AgentType;
  parentId?: string;
  capabilities?: string[];
  authority: Partial<AuthorityScope> & {
    maxPerTransaction: number | string;
    maxPerDay: number | string;
  };
  metadata?: Record<string, unknown>;
}

// ── Wallet & Value Types ──────────────────────────────────────

export type ValueUnitType =
  | 'FIAT'
  | 'AI_TOKEN'
  | 'COMPUTE_CREDIT'
  | 'OUTCOME_SCORE'
  | 'PLATFORM_CREDIT'
  | 'ENVIRONMENTAL';

export interface Balance {
  valueUnitType: ValueUnitType;
  currency?: string; // e.g. 'USD', 'EUR' for FIAT
  amount: number;
  reserved: number;
  available: number;
}

export interface FundingConfig {
  type: 'LINKED_BANK' | 'PARENT_DRAWDOWN' | 'PREPAID';
  sourceId: string;
  autoTopup?: AutoTopupRule;
}

export interface AutoTopupRule {
  threshold: number;
  amount: number;
  maxPerDay: number;
}

export interface LedgerEntry {
  entryId: string;
  timestamp: Date;
  type: 'DEBIT' | 'CREDIT' | 'RESERVE' | 'RELEASE' | 'TOPUP';
  amount: number;
  valueUnitType: ValueUnitType;
  currency?: string;
  counterpartyAgentId?: string;
  transactionId?: string;
  description: string;
  balanceAfter: number;
}

export interface Wallet {
  walletId: string;
  ownerAgentId: string;
  balances: Balance[];
  fundingSource?: FundingConfig;
  frozen: boolean;
  createdAt: Date;
}

export interface FundWalletOptions {
  amount: number | string;
  source?: string;
  valueUnitType?: ValueUnitType;
  currency?: string;
}

// ── Pricing Types ─────────────────────────────────────────────

export type PricingPrimitive =
  | 'FIXED'
  | 'UNIT_RATE'
  | 'TIERED'
  | 'PERCENTAGE'
  | 'THRESHOLD'
  | 'TIME_WINDOW'
  | 'CONDITIONAL'
  | 'COMPOSITE';

export type CompositeOperator = 'ADD' | 'MAX' | 'MIN' | 'FIRST_MATCH';

export interface PricingRuleBase {
  ruleId: string;
  name: string;
  description?: string;
  primitive: PricingPrimitive;
}

export interface FixedRule extends PricingRuleBase {
  primitive: 'FIXED';
  amount: number;
  period?: 'PER_EVENT' | 'HOURLY' | 'DAILY' | 'MONTHLY' | 'YEARLY';
}

export interface UnitRateRule extends PricingRuleBase {
  primitive: 'UNIT_RATE';
  rate: number;
  unit: string; // 'TOKEN', 'API_CALL', 'GPU_SECOND', etc.
}

export interface TierBand {
  from: number;
  to: number | null; // null = unlimited
  rate: number;
}

export interface TieredRule extends PricingRuleBase {
  primitive: 'TIERED';
  tiers: TierBand[];
  mode: 'GRADUATED' | 'VOLUME'; // graduated = each unit in tier at tier rate; volume = all units at qualifying tier rate
}

export interface PercentageRule extends PricingRuleBase {
  primitive: 'PERCENTAGE';
  percentage: number; // 0-1
  referenceField: string; // what the percentage is of
  min?: number;
  max?: number;
}

export interface ThresholdRule extends PricingRuleBase {
  primitive: 'THRESHOLD';
  threshold: number;
  belowRate: number;
  aboveRate: number;
}

export interface TimeWindowBand {
  dayOfWeek?: number[]; // 0=Sun, 6=Sat
  startHour: number;
  endHour: number;
  rate: number;
  label?: string; // 'peak', 'off-peak', etc.
}

export interface TimeWindowRule extends PricingRuleBase {
  primitive: 'TIME_WINDOW';
  windows: TimeWindowBand[];
  defaultRate: number;
  timezone: string;
}

export interface ConditionalBranch {
  condition: string; // expression, e.g. "outcome == 'SUCCESS'"
  rule: PricingRule;
}

export interface ConditionalRule extends PricingRuleBase {
  primitive: 'CONDITIONAL';
  field: string;
  branches: ConditionalBranch[];
  fallback?: PricingRule;
}

export interface CompositeRule extends PricingRuleBase {
  primitive: 'COMPOSITE';
  operator: CompositeOperator;
  rules: PricingRule[];
}

export type PricingRule =
  | FixedRule
  | UnitRateRule
  | TieredRule
  | PercentageRule
  | ThresholdRule
  | TimeWindowRule
  | ConditionalRule
  | CompositeRule;

// ── Contract Types ────────────────────────────────────────────

export type ContractMode = 'PRE_NEGOTIATED' | 'TEMPLATE' | 'DYNAMIC';
export type ContractStatus = 'DRAFT' | 'PROPOSED' | 'ACTIVE' | 'EXPIRED' | 'TERMINATED';

export interface Contract {
  contractId: string;
  mode: ContractMode;
  status: ContractStatus;
  parties: { sourceAgentId: string; targetAgentId: string };
  pricingRules: PricingRule[];
  effectiveFrom: Date;
  effectiveUntil?: Date;
  metadata: Record<string, unknown>;
  createdAt: Date;
}

export interface CreateContractOptions {
  mode?: ContractMode;
  targetAgentId: string;
  pricingRules: Omit<PricingRule, 'ruleId'>[];
  effectiveFrom?: Date;
  effectiveUntil?: Date;
  metadata?: Record<string, unknown>;
}

// ── Metering & Usage Types ────────────────────────────────────

export interface UsageEvent {
  eventId: string;
  sourceAgentId: string;
  targetAgentId: string;
  contractId: string;
  serviceId: string;
  timestamp: Date;
  quantity: number;
  unit: string;
  dimensions: Record<string, string | number>;
  outcome?: OutcomeAttestation;
  signature?: string;
}

export type OutcomeType =
  | 'TASK_COMPLETION'
  | 'METRIC_IMPROVEMENT'
  | 'REVENUE_GENERATED'
  | 'COST_SAVED'
  | 'CUSTOM';

export type VerificationMethod =
  | 'SELF_REPORTED'
  | 'BILATERAL_AGREEMENT'
  | 'THIRD_PARTY_ORACLE'
  | 'AUTOMATED_TEST';

export type AttestationStatus = 'CLAIMED' | 'VERIFIED' | 'DISPUTED' | 'EXPIRED';

export interface OutcomeAttestation {
  outcomeId: string;
  outcomeType: OutcomeType;
  claimedBy: string;
  evidence: Evidence[];
  verificationMethod: VerificationMethod;
  verifiedBy?: string;
  confidenceScore: number; // 0-1
  attestationStatus: AttestationStatus;
  disputeWindow: number; // ms
}

export interface Evidence {
  type: 'LOG' | 'METRIC' | 'SCREENSHOT' | 'THIRD_PARTY' | 'TEST_RESULT';
  uri: string;
  hash: string;
  description?: string;
}

// ── Settlement Types ──────────────────────────────────────────

export type SettlementPattern =
  | 'INSTANT_DRAWDOWN'
  | 'ESCROW_RELEASE'
  | 'WATERFALL_SPLIT'
  | 'NET_SETTLEMENT'
  | 'CONDITIONAL_RELEASE'
  | 'CROSS_CURRENCY_ATOMIC';

export type SettlementStatus = 'PENDING' | 'PROCESSING' | 'SETTLED' | 'FAILED' | 'REVERSED';

export interface RatedRecord {
  ratedRecordId: string;
  usageEventId: string;
  contractId: string;
  pricingRuleId: string;
  quantity: number;
  rate: number;
  amount: number;
  currency: string;
  ratedAt: Date;
}

export interface Settlement {
  settlementId: string;
  pattern: SettlementPattern;
  status: SettlementStatus;
  sourceAgentId: string;
  targetAgentId: string;
  ratedRecords: RatedRecord[];
  totalAmount: number;
  currency: string;
  settledAt?: Date;
  auditId: string;
}

// ── Transaction Types ─────────────────────────────────────────

export interface TransactOptions {
  from: string;
  to: string;
  service: string;
  payload?: Record<string, unknown>;
  maxCost?: number | string;
}

export interface TransactionResult {
  transactionId: string;
  cost: number;
  currency: string;
  outcome?: OutcomeAttestation;
  auditId: string;
  settledAt: Date;
  duration: number; // ms
}

// ── Audit Types ───────────────────────────────────────────────

export interface AuditRecord {
  auditId: string;
  what: { operation: string; entityType: string; entityId: string; amount?: number };
  who: { sourceAgentId: string; targetAgentId: string; humanOwnerId?: string };
  when: Date;
  why: { contractId?: string; pricingRuleId?: string; justification?: string };
  how: { policiesEvaluated: string[]; policiesPassed: string[]; overrides?: string[] };
  result: { balanceBefore?: number; balanceAfter?: number; settlementAmount?: number; status: string };
}

// ── Dispute Types ─────────────────────────────────────────────

export type DisputeStage =
  | 'AUTOMATED_RECONCILIATION'
  | 'AGENT_NEGOTIATION'
  | 'ARBITRATION_ORACLE'
  | 'HUMAN_ESCALATION';

export type DisputeStatus = 'OPEN' | 'IN_PROGRESS' | 'RESOLVED' | 'ESCALATED' | 'CLOSED';

export interface Dispute {
  disputeId: string;
  transactionId: string;
  openedBy: string;
  respondent: string;
  stage: DisputeStage;
  status: DisputeStatus;
  reason: string;
  evidence: Evidence[];
  amount: number;
  resolution?: { outcome: 'UPHELD' | 'REJECTED' | 'PARTIAL'; adjustedAmount: number };
  openedAt: Date;
  resolvedAt?: Date;
}

// ── Policy Types ──────────────────────────────────────────────

export type PolicyType =
  | 'SPENDING_LIMIT'
  | 'COUNTERPARTY_ALLOWLIST'
  | 'SERVICE_ALLOWLIST'
  | 'RATE_REASONABLENESS'
  | 'OUTCOME_VERIFICATION'
  | 'COMPLIANCE'
  | 'ANOMALY_DETECTION'
  | 'BUDGET_ALLOCATION';

export type ViolationAction = 'HARD_BLOCK' | 'SOFT_BLOCK' | 'ALERT' | 'LOG';

export interface Policy {
  policyId: string;
  type: PolicyType;
  agentId: string;
  config: Record<string, unknown>;
  violationAction: ViolationAction;
  enabled: boolean;
}

// ── SDK Config ────────────────────────────────────────────────

export interface UMPConfig {
  apiKey: string;
  baseUrl?: string;
  timeout?: number;
  retries?: number;
  onAudit?: (record: AuditRecord) => void;
}
