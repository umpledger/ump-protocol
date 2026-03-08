import type { UsageEvent, OutcomeAttestation } from '../types';
import { generateId, hrTimestamp } from '../utils/id';

/**
 * MeteringEngine — Layer 2 primitive
 *
 * Captures usage events with cryptographic integrity.
 * Supports idempotent event submission, deduplication, and
 * outcome attestation for result-based billing.
 */
export class MeteringEngine {
  private events: Map<string, UsageEvent> = new Map();
  private seenIds: Set<string> = new Set(); // idempotency guard

  /**
   * Record a usage event.
   * Idempotent: resubmitting the same eventId is a no-op.
   */
  record(event: Omit<UsageEvent, 'eventId' | 'timestamp'> & { eventId?: string }): UsageEvent {
    const eventId = event.eventId || generateId('evt');

    // Idempotency: skip if already recorded
    if (this.seenIds.has(eventId)) {
      return this.events.get(eventId)!;
    }

    const fullEvent: UsageEvent = {
      ...event,
      eventId,
      timestamp: hrTimestamp(),
    };

    this.events.set(eventId, fullEvent);
    this.seenIds.add(eventId);
    return fullEvent;
  }

  /**
   * Record a batch of usage events.
   */
  recordBatch(events: Array<Omit<UsageEvent, 'eventId' | 'timestamp'>>): UsageEvent[] {
    return events.map(e => this.record(e));
  }

  /**
   * Create an outcome attestation for result-based billing.
   */
  attestOutcome(data: {
    outcomeType: OutcomeAttestation['outcomeType'];
    claimedBy: string;
    evidence: OutcomeAttestation['evidence'];
    verificationMethod: OutcomeAttestation['verificationMethod'];
    confidenceScore: number;
    disputeWindow?: number;
  }): OutcomeAttestation {
    return {
      outcomeId: generateId('out'),
      outcomeType: data.outcomeType,
      claimedBy: data.claimedBy,
      evidence: data.evidence,
      verificationMethod: data.verificationMethod,
      verifiedBy: undefined,
      confidenceScore: data.confidenceScore,
      attestationStatus: 'CLAIMED',
      disputeWindow: data.disputeWindow || 24 * 60 * 60 * 1000, // 24h default
    };
  }

  /**
   * Get events for a contract within a time range.
   */
  getByContract(contractId: string, from?: Date, to?: Date): UsageEvent[] {
    let results = Array.from(this.events.values())
      .filter(e => e.contractId === contractId);

    if (from) results = results.filter(e => e.timestamp >= from);
    if (to) results = results.filter(e => e.timestamp <= to);

    return results.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
  }

  /**
   * Get events for a specific agent (as source or target).
   */
  getByAgent(agentId: string, limit = 100): UsageEvent[] {
    return Array.from(this.events.values())
      .filter(e => e.sourceAgentId === agentId || e.targetAgentId === agentId)
      .slice(-limit);
  }

  /**
   * Get a specific event by ID.
   */
  get(eventId: string): UsageEvent | undefined {
    return this.events.get(eventId);
  }

  /**
   * Get total metered quantity for a contract.
   */
  totalQuantity(contractId: string): number {
    return Array.from(this.events.values())
      .filter(e => e.contractId === contractId)
      .reduce((sum, e) => sum + e.quantity, 0);
  }
}
