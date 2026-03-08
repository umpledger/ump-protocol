import { FastifyInstance } from 'fastify';
import { getUMP } from '../ump-instance';

/**
 * Agent Management Routes — /ump/v2/agents
 *
 * POST   /agents           Create a new Agent Identity
 * GET    /agents/:id       Retrieve agent details
 * PATCH  /agents/:id/authority  Update spending limits
 * DELETE /agents/:id       Revoke agent (cascades to children)
 * POST   /agents/:id/verify    Verify counterparty identity
 * GET    /agents           List agents (with filters)
 */
export async function agentRoutes(app: FastifyInstance) {
  const ump = getUMP();

  // POST /agents — Register a new agent
  app.post('/agents', async (request, reply) => {
    const body = request.body as any;

    const agent = ump.agents.create({
      name: body.name,
      type: body.type || 'AI_AGENT',
      parentId: body.parent_id,
      capabilities: body.capabilities || [],
      authority: {
        maxPerTransaction: body.authority?.max_per_transaction || body.authority?.maxPerTransaction,
        maxPerDay: body.authority?.max_per_day || body.authority?.maxPerDay,
        maxPerMonth: body.authority?.max_per_month || body.authority?.maxPerMonth,
        allowedServices: body.authority?.allowed_services,
        allowedCounterparties: body.authority?.allowed_counterparties,
        requiresApprovalAbove: body.authority?.requires_approval_above,
        autoRevokeAfter: body.authority?.auto_revoke_after,
      },
      metadata: body.metadata,
    });

    // Auto-create wallet
    const wallet = ump.wallets.create(agent.agentId);

    reply.code(201).send({
      agent_id: agent.agentId,
      agent_type: agent.agentType,
      display_name: agent.displayName,
      parent_id: agent.parentId,
      capabilities: agent.capabilities,
      authority_scope: {
        max_per_transaction: agent.authorityScope.maxPerTransaction,
        max_per_day: agent.authorityScope.maxPerDay,
        max_per_month: agent.authorityScope.maxPerMonth,
        allowed_services: agent.authorityScope.allowedServices,
        allowed_counterparties: agent.authorityScope.allowedCounterparties,
      },
      wallet_id: wallet.walletId,
      status: agent.status,
      created_at: agent.createdAt.toISOString(),
    });
  });

  // GET /agents/:id — Get agent details
  app.get('/agents/:id', async (request) => {
    const { id } = request.params as any;
    const agent = ump.agents.get(id);

    let walletBalance = 0;
    try {
      const wallet = ump.wallets.getByAgent(id);
      const balances = ump.wallets.getBalance(wallet.walletId);
      walletBalance = balances[0]?.available || 0;
    } catch { /* no wallet */ }

    return {
      agent_id: agent.agentId,
      agent_type: agent.agentType,
      display_name: agent.displayName,
      parent_id: agent.parentId,
      capabilities: agent.capabilities,
      authority_scope: agent.authorityScope,
      wallet_balance: walletBalance,
      status: agent.status,
      metadata: agent.metadata,
      created_at: agent.createdAt.toISOString(),
    };
  });

  // PATCH /agents/:id/authority — Update spending limits
  app.patch('/agents/:id/authority', async (request) => {
    const { id } = request.params as any;
    const body = request.body as any;

    const updated = ump.agents.updateAuthority(id, {
      maxPerTransaction: body.max_per_transaction,
      maxPerDay: body.max_per_day,
      maxPerMonth: body.max_per_month,
      allowedServices: body.allowed_services,
      allowedCounterparties: body.allowed_counterparties,
    });

    return {
      agent_id: updated.agentId,
      authority_scope: updated.authorityScope,
      updated_at: updated.updatedAt.toISOString(),
    };
  });

  // DELETE /agents/:id — Revoke agent (cascades)
  app.delete('/agents/:id', async (request) => {
    const { id } = request.params as any;
    const revoked = ump.agents.revoke(id);

    return {
      revoked_agents: revoked,
      count: revoked.length,
      message: `Agent ${id} and ${revoked.length - 1} child agents revoked`,
    };
  });

  // POST /agents/:id/verify — Verify agent identity
  app.post('/agents/:id/verify', async (request) => {
    const { id } = request.params as any;
    const result = ump.agents.verify(id);

    return {
      agent_id: id,
      valid: result.valid,
      reason: result.reason,
      verified_at: new Date().toISOString(),
    };
  });

  // GET /agents — List agents
  app.get('/agents', async (request) => {
    const query = request.query as any;
    const agents = ump.agents.list({
      parentId: query.parent_id,
      type: query.type,
      status: query.status,
    });

    return {
      agents: agents.map(a => ({
        agent_id: a.agentId,
        agent_type: a.agentType,
        display_name: a.displayName,
        status: a.status,
        created_at: a.createdAt.toISOString(),
      })),
      total: agents.length,
    };
  });
}
