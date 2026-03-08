/**
 * Singleton UMP instance for the server.
 *
 * In alpha: uses in-memory SDK.
 * In production: this will be replaced with a PostgreSQL-backed implementation
 * that uses the same interfaces but persists to the database.
 */

import { UMP } from '@umpledger/sdk';

let instance: UMP | null = null;

export function getUMP(): UMP {
  if (!instance) {
    instance = new UMP({
      apiKey: 'ump_sk_server_internal',
      onAudit: (record) => {
        // In production: write to PostgreSQL audit_trail table
        // For now: logged via Fastify's pino logger
        if (process.env.LOG_AUDIT === 'true') {
          console.log(JSON.stringify({
            level: 'info',
            msg: 'audit',
            audit_id: record.auditId,
            operation: record.what.operation,
            amount: record.what.amount,
          }));
        }
      },
    });
  }
  return instance;
}

/**
 * Reset the UMP instance (for testing).
 */
export function resetUMP(): void {
  instance = null;
}
