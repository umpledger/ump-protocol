import { FastifyInstance } from 'fastify';
import { getUMP } from '../ump-instance';

/**
 * Dispute Routes — /ump/v2/disputes
 */
export async function disputeRoutes(app: FastifyInstance) {
  const ump = getUMP();

  // POST /disputes — Open a dispute
  app.post('/disputes', async (request, reply) => {
    const body = request.body as any;

    // For alpha, disputes are tracked in audit trail
    const auditId = ump.audit.record({
      what: {
        operation: 'DISPUTE_OPENED',
        entityType: 'dispute',
        entityId: body.transaction_id,
        amount: body.amount,
      },
      who: {
        sourceAgentId: body.opened_by,
        targetAgentId: body.respondent,
      },
      why: { justification: body.reason },
      how: { policiesEvaluated: ['DISPUTE_PROTOCOL'], policiesPassed: [] },
      result: { status: 'OPEN' },
    });

    reply.code(201).send({
      dispute_id: auditId,
      stage: 'AUTOMATED_RECONCILIATION',
      status: 'OPEN',
      message: 'Dispute opened. Automated reconciliation in progress.',
    });
  });

  // GET /disputes/:id
  app.get('/disputes/:id', async (request, reply) => {
    const { id } = request.params as any;
    const record = ump.audit.get(id);

    if (!record || record.what.operation !== 'DISPUTE_OPENED') {
      reply.code(404).send({ error: 'NOT_FOUND' });
      return;
    }

    return {
      dispute_id: id,
      transaction_id: record.what.entityId,
      opened_by: record.who.sourceAgentId,
      respondent: record.who.targetAgentId,
      reason: record.why.justification,
      amount: record.what.amount,
      status: record.result.status,
      opened_at: record.when.toISOString(),
    };
  });

  // POST /policies — Create a governance policy
  app.post('/policies', async (request, reply) => {
    const body = request.body as any;

    const auditId = ump.audit.record({
      what: {
        operation: 'POLICY_CREATED',
        entityType: 'policy',
        entityId: body.agent_id,
      },
      who: { sourceAgentId: body.agent_id, targetAgentId: body.agent_id },
      why: { justification: `Policy: ${body.policy_type}` },
      how: { policiesEvaluated: [], policiesPassed: [] },
      result: { status: 'ACTIVE' },
    });

    reply.code(201).send({
      policy_id: auditId,
      policy_type: body.policy_type,
      agent_id: body.agent_id,
      config: body.config,
      violation_action: body.violation_action || 'HARD_BLOCK',
      enabled: true,
    });
  });

  // POST /policies/evaluate — Dry-run a transaction against policies
  app.post('/policies/evaluate', async (request) => {
    const body = request.body as any;

    const authCheck = ump.agents.checkAuthority(
      body.agent_id,
      body.amount,
      body.counterparty_id,
      body.service_id,
    );

    return {
      agent_id: body.agent_id,
      amount: body.amount,
      allowed: authCheck.allowed,
      reason: authCheck.reason,
      requires_approval: authCheck.requiresApproval || false,
      policies_evaluated: ['SPENDING_LIMIT', 'COUNTERPARTY_ALLOWLIST', 'SERVICE_ALLOWLIST'],
    };
  });
}
