import { FastifyInstance } from 'fastify';
import { getUMP } from '../ump-instance';

/**
 * Contract Routes — /ump/v2/contracts
 *
 * POST  /contracts            Create a contract
 * GET   /contracts/:id        Get contract details
 * POST  /contracts/negotiate  Dynamic negotiation (propose → counter → accept)
 * POST  /contracts/:id/accept Accept a proposed contract
 * POST  /contracts/:id/counter Counter-propose
 * DELETE /contracts/:id        Terminate a contract
 * GET   /contracts             List contracts
 */
export async function contractRoutes(app: FastifyInstance) {
  const ump = getUMP();

  // POST /contracts
  app.post('/contracts', async (request, reply) => {
    const body = request.body as any;

    const contract = ump.contracts.create(body.source_agent_id, {
      mode: body.mode,
      targetAgentId: body.target_agent_id,
      pricingRules: body.pricing_rules,
      effectiveFrom: body.effective_from ? new Date(body.effective_from) : undefined,
      effectiveUntil: body.effective_until ? new Date(body.effective_until) : undefined,
      metadata: body.metadata,
    });

    reply.code(201).send({
      contract_id: contract.contractId,
      mode: contract.mode,
      status: contract.status,
      parties: {
        source: contract.parties.sourceAgentId,
        target: contract.parties.targetAgentId,
      },
      pricing_rules: contract.pricingRules,
      effective_from: contract.effectiveFrom.toISOString(),
      effective_until: contract.effectiveUntil?.toISOString(),
      created_at: contract.createdAt.toISOString(),
    });
  });

  // GET /contracts/:id
  app.get('/contracts/:id', async (request) => {
    const { id } = request.params as any;
    const contract = ump.contracts.get(id);

    return {
      contract_id: contract.contractId,
      mode: contract.mode,
      status: contract.status,
      parties: contract.parties,
      pricing_rules: contract.pricingRules,
      effective_from: contract.effectiveFrom.toISOString(),
      effective_until: contract.effectiveUntil?.toISOString(),
      metadata: contract.metadata,
      created_at: contract.createdAt.toISOString(),
    };
  });

  // POST /contracts/negotiate — Start dynamic negotiation
  app.post('/contracts/negotiate', async (request, reply) => {
    const body = request.body as any;

    const proposal = ump.contracts.propose(body.source_agent_id, {
      targetAgentId: body.target_agent_id,
      pricingRules: body.pricing_rules,
      metadata: body.metadata,
    });

    reply.code(201).send({
      contract_id: proposal.contractId,
      mode: 'DYNAMIC',
      status: proposal.status,
      message: 'Proposal created. Counterparty can accept or counter.',
    });
  });

  // POST /contracts/:id/accept
  app.post('/contracts/:id/accept', async (request) => {
    const { id } = request.params as any;
    const accepted = ump.contracts.accept(id);

    return {
      contract_id: accepted.contractId,
      status: accepted.status,
      message: 'Contract accepted and now active.',
    };
  });

  // POST /contracts/:id/counter
  app.post('/contracts/:id/counter', async (request, reply) => {
    const { id } = request.params as any;
    const body = request.body as any;

    const counter = ump.contracts.counter(id, body.counter_agent_id, body.pricing_rules);

    reply.code(201).send({
      contract_id: counter.contractId,
      original_contract_id: id,
      status: counter.status,
      message: 'Counter-proposal created.',
    });
  });

  // DELETE /contracts/:id — Terminate
  app.delete('/contracts/:id', async (request) => {
    const { id } = request.params as any;
    const terminated = ump.contracts.terminate(id);

    return {
      contract_id: terminated.contractId,
      status: terminated.status,
      message: 'Contract terminated.',
    };
  });

  // GET /contracts — List contracts
  app.get('/contracts', async (request) => {
    const query = request.query as any;
    const contracts = ump.contracts.listByAgent(query.agent_id, query.status);

    return {
      contracts: contracts.map(c => ({
        contract_id: c.contractId,
        mode: c.mode,
        status: c.status,
        parties: c.parties,
        created_at: c.createdAt.toISOString(),
      })),
      total: contracts.length,
    };
  });
}
