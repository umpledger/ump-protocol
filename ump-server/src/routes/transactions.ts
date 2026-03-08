import { FastifyInstance } from 'fastify';
import { getUMP } from '../ump-instance';

/**
 * Transaction Routes — /ump/v2
 *
 * POST  /transact         Execute a full transaction (meter + rate + settle)
 * POST  /usage-events     Submit raw usage events
 * POST  /rate             Rate usage events against pricing rules
 * POST  /settle           Execute settlement for rated records
 * GET   /transactions/:id Get transaction details
 */
export async function transactionRoutes(app: FastifyInstance) {
  const ump = getUMP();

  // POST /transact — The high-level one-call transaction
  app.post('/transact', async (request, reply) => {
    const body = request.body as any;

    const result = await ump.transact({
      from: body.from,
      to: body.to,
      service: body.service,
      payload: body.payload,
      maxCost: body.max_cost,
    });

    reply.code(201).send({
      transaction_id: result.transactionId,
      cost: result.cost,
      currency: result.currency,
      outcome: result.outcome,
      audit_id: result.auditId,
      settled_at: result.settledAt.toISOString(),
      duration_ms: result.duration,
    });
  });

  // POST /usage-events — Submit raw usage events
  app.post('/usage-events', async (request, reply) => {
    const body = request.body as any;
    const events = Array.isArray(body) ? body : [body];

    const recorded = events.map(e => ump.metering.record({
      eventId: e.event_id,
      sourceAgentId: e.source_agent_id || e.from,
      targetAgentId: e.target_agent_id || e.to,
      contractId: e.contract_id,
      serviceId: e.service_id || e.service,
      quantity: e.quantity,
      unit: e.unit,
      dimensions: e.dimensions || {},
    }));

    reply.code(201).send({
      events: recorded.map(e => ({
        event_id: e.eventId,
        source_agent_id: e.sourceAgentId,
        target_agent_id: e.targetAgentId,
        quantity: e.quantity,
        unit: e.unit,
        timestamp: e.timestamp.toISOString(),
      })),
      count: recorded.length,
    });
  });

  // POST /rate — Rate usage events against pricing rules
  app.post('/rate', async (request) => {
    const body = request.body as any;
    const contract = ump.contracts.get(body.contract_id);
    const rule = contract.pricingRules[0]; // primary rule

    const events = body.event_ids
      ? body.event_ids.map((id: string) => ump.metering.get(id)).filter(Boolean)
      : ump.metering.getByContract(body.contract_id);

    const rated = ump.pricing.rateBatch(rule, events);

    return {
      rated_records: rated.map(r => ({
        rated_record_id: r.ratedRecordId,
        usage_event_id: r.usageEventId,
        quantity: r.quantity,
        rate: r.rate,
        amount: r.amount,
        currency: r.currency,
        rated_at: r.ratedAt.toISOString(),
      })),
      total_amount: rated.reduce((sum, r) => sum + r.amount, 0),
      count: rated.length,
    };
  });

  // POST /settle — Execute settlement
  app.post('/settle', async (request, reply) => {
    const body = request.body as any;

    const { settlement, auditId } = ump.settlement.settleInstant(
      body.source_agent_id,
      body.target_agent_id,
      body.rated_records || [],
    );

    reply.code(201).send({
      settlement_id: settlement.settlementId,
      pattern: settlement.pattern,
      status: settlement.status,
      total_amount: settlement.totalAmount,
      currency: settlement.currency,
      audit_id: auditId,
      settled_at: settlement.settledAt?.toISOString(),
    });
  });

  // POST /pricing-rules/simulate — What-if pricing simulation
  app.post('/pricing-rules/simulate', async (request) => {
    const body = request.body as any;
    const amount = ump.pricing.simulate(body.rule, body.quantity, body.dimensions);

    return {
      quantity: body.quantity,
      projected_cost: amount,
      currency: 'USD',
      rule_name: body.rule?.name,
    };
  });

  // POST /pricing-rules/explain — Human-readable pricing breakdown
  app.post('/pricing-rules/explain', async (request) => {
    const body = request.body as any;
    const explanation = ump.pricing.explain(body.rule, {
      event: {
        eventId: 'explain',
        sourceAgentId: 'explain',
        targetAgentId: 'explain',
        contractId: 'explain',
        serviceId: 'explain',
        timestamp: new Date(),
        quantity: body.quantity || 1,
        unit: body.unit || 'UNIT',
        dimensions: body.dimensions || {},
      },
    });

    return { explanation, rule_name: body.rule?.name };
  });
}
