import type { AuditRecord } from '../types';
import { generateId, hrTimestamp } from '../utils/id';

/**
 * AuditTrail — Layer 3 primitive
 *
 * Immutable append-only log of every UMP operation.
 * Captures 6 dimensions: WHAT, WHO, WHEN, WHY, HOW, RESULT.
 */
export class AuditTrail {
  private records: AuditRecord[] = [];
  private onAudit?: (record: AuditRecord) => void;

  constructor(onAudit?: (record: AuditRecord) => void) {
    this.onAudit = onAudit;
  }

  /**
   * Record an audit entry. Returns the audit ID.
   */
  record(data: Omit<AuditRecord, 'auditId' | 'when'>): string {
    const auditId = generateId('aud');
    const record: AuditRecord = {
      auditId,
      when: hrTimestamp(),
      ...data,
    };
    this.records.push(record);

    // Fire callback if registered (for real-time dashboards, etc.)
    if (this.onAudit) {
      this.onAudit(record);
    }

    return auditId;
  }

  /**
   * Query audit records with filters.
   */
  query(filters?: {
    agentId?: string;
    operation?: string;
    fromDate?: Date;
    toDate?: Date;
    minAmount?: number;
    contractId?: string;
  }, limit = 100, offset = 0): AuditRecord[] {
    let results = this.records;

    if (filters) {
      if (filters.agentId) {
        results = results.filter(r =>
          r.who.sourceAgentId === filters.agentId ||
          r.who.targetAgentId === filters.agentId
        );
      }
      if (filters.operation) {
        results = results.filter(r => r.what.operation === filters.operation);
      }
      if (filters.fromDate) {
        results = results.filter(r => r.when >= filters.fromDate!);
      }
      if (filters.toDate) {
        results = results.filter(r => r.when <= filters.toDate!);
      }
      if (filters.minAmount !== undefined) {
        results = results.filter(r => (r.what.amount || 0) >= filters.minAmount!);
      }
      if (filters.contractId) {
        results = results.filter(r => r.why.contractId === filters.contractId);
      }
    }

    return results.slice(offset, offset + limit);
  }

  /**
   * Get a specific audit record by ID.
   */
  get(auditId: string): AuditRecord | undefined {
    return this.records.find(r => r.auditId === auditId);
  }

  /**
   * Get total count of records.
   */
  count(): number {
    return this.records.length;
  }
}
