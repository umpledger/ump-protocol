import { FastifyInstance } from 'fastify';
import { getUMP } from '../ump-instance';

/**
 * Wallet Routes — /ump/v2/wallets
 *
 * POST  /wallets/:id/fund       Fund a wallet
 * GET   /wallets/:id/balance    Get real-time balance
 * GET   /wallets/:id/ledger     Get spending ledger
 * POST  /wallets/:id/freeze     Emergency freeze
 * POST  /wallets/:id/unfreeze   Unfreeze
 * POST  /wallets/:id/transfer   Transfer between wallets
 */
export async function walletRoutes(app: FastifyInstance) {
  const ump = getUMP();

  // POST /wallets/:id/fund
  app.post('/wallets/:id/fund', async (request, reply) => {
    const { id } = request.params as any;
    const body = request.body as any;

    const entry = ump.wallets.fund(id, {
      amount: body.amount,
      source: body.source,
      valueUnitType: body.value_unit_type,
      currency: body.currency,
    });

    reply.code(201).send({
      entry_id: entry.entryId,
      type: entry.type,
      amount: entry.amount,
      balance_after: entry.balanceAfter,
      timestamp: entry.timestamp.toISOString(),
    });
  });

  // GET /wallets/:id/balance
  app.get('/wallets/:id/balance', async (request) => {
    const { id } = request.params as any;
    const balances = ump.wallets.getBalance(id);
    const wallet = ump.wallets.get(id);

    return {
      wallet_id: id,
      frozen: wallet.frozen,
      balances: balances.map(b => ({
        value_unit_type: b.valueUnitType,
        currency: b.currency,
        amount: b.amount,
        reserved: b.reserved,
        available: b.available,
      })),
    };
  });

  // GET /wallets/:id/ledger
  app.get('/wallets/:id/ledger', async (request) => {
    const { id } = request.params as any;
    const query = request.query as any;
    const limit = parseInt(query.limit || '50');
    const offset = parseInt(query.offset || '0');

    const entries = ump.wallets.getLedger(id, limit, offset);

    return {
      wallet_id: id,
      entries: entries.map(e => ({
        entry_id: e.entryId,
        type: e.type,
        amount: e.amount,
        currency: e.currency,
        counterparty_agent_id: e.counterpartyAgentId,
        transaction_id: e.transactionId,
        description: e.description,
        balance_after: e.balanceAfter,
        timestamp: e.timestamp.toISOString(),
      })),
      count: entries.length,
      limit,
      offset,
    };
  });

  // POST /wallets/:id/freeze
  app.post('/wallets/:id/freeze', async (request) => {
    const { id } = request.params as any;
    ump.wallets.freeze(id);

    return {
      wallet_id: id,
      frozen: true,
      message: 'Wallet frozen. All transactions blocked.',
    };
  });

  // POST /wallets/:id/unfreeze
  app.post('/wallets/:id/unfreeze', async (request) => {
    const { id } = request.params as any;
    ump.wallets.unfreeze(id);

    return {
      wallet_id: id,
      frozen: false,
      message: 'Wallet unfrozen. Transactions resumed.',
    };
  });

  // POST /wallets/:id/transfer
  app.post('/wallets/:id/transfer', async (request) => {
    const { id } = request.params as any;
    const body = request.body as any;
    const txnId = `txn_transfer_${Date.now()}`;

    const debitEntry = ump.wallets.debit(id, body.amount, body.target_agent_id, txnId);

    const targetWallet = ump.wallets.getByAgent(body.target_agent_id);
    const creditEntry = ump.wallets.credit(targetWallet.walletId, body.amount, body.source_agent_id || 'transfer', txnId);

    return {
      transaction_id: txnId,
      amount: body.amount,
      from_wallet: id,
      to_wallet: targetWallet.walletId,
      debit_entry: debitEntry.entryId,
      credit_entry: creditEntry.entryId,
    };
  });
}
