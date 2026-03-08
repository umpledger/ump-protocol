import { FastifyInstance } from 'fastify';
import { getUMP } from '../ump-instance';

/**
 * Audit Trail Routes — /ump/v2/audit-trail
 */
export async function auditRoutes(app: FastifyInstance) {
  const ump = getUMP();

  // GET /audit-trail — Query audit records
  app.get('/audit-trail', async (request) => {
    const query = request.query as any;

    const records = ump.audit.query({
      agentId: query.agent_id,
      operation: query.operation,
      fromDate: query.from ? new Date(query.from) : undefined,
      toDate: query.to ? new Date(query.to) : undefined,
      minAmount: query.min_amount ? parseFloat(query.min_amount) : undefined,
      contractId: query.contract_id,
    }, parseInt(query.limit || '50'), parseInt(query.offset || '0'));

    return {
      records: records.map(r => ({
        audit_id: r.auditId,
        what: r.what,
        who: r.who,
        when: r.when.toISOString(),
        why: r.why,
        how: r.how,
        result: r.result,
      })),
      total: records.length,
    };
  });

  // GET /audit-trail/:id
  app.get('/audit-trail/:id', async (request, reply) => {
    const { id } = request.params as any;
    const record = ump.audit.get(id);

    if (!record) {
      reply.code(404).send({ error: 'NOT_FOUND', message: `Audit record ${id} not found` });
      return;
    }

    return {
      audit_id: record.auditId,
      what: record.what,
      who: record.who,
      when: record.when.toISOString(),
      why: record.why,
      how: record.how,
      result: record.result,
    };
  });
}
