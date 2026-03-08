import Fastify from 'fastify';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import { agentRoutes } from './routes/agents';
import { walletRoutes } from './routes/wallets';
import { transactionRoutes } from './routes/transactions';
import { contractRoutes } from './routes/contracts';
import { auditRoutes } from './routes/audit';
import { disputeRoutes } from './routes/disputes';
import { authMiddleware } from './middleware/auth';
import { errorHandler } from './middleware/errors';

const PORT = parseInt(process.env.PORT || '3000');
const HOST = process.env.HOST || '0.0.0.0';

async function build() {
  const app = Fastify({
    logger: {
      level: process.env.LOG_LEVEL || 'info',
      transport: process.env.NODE_ENV !== 'production'
        ? { target: 'pino-pretty', options: { colorize: true } }
        : undefined,
    },
    genReqId: () => `req_${Date.now().toString(36)}`,
  });

  // ── Plugins ──
  await app.register(cors, { origin: true });
  await app.register(rateLimit, {
    max: parseInt(process.env.RATE_LIMIT_MAX || '1000'),
    timeWindow: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '60000'),
    keyGenerator: (req) => req.headers['x-api-key'] as string || req.ip,
  });

  // ── Auth middleware ──
  app.addHook('onRequest', authMiddleware);

  // ── Error handler ──
  app.setErrorHandler(errorHandler as any);

  // ── Health check ──
  app.get('/health', async () => ({
    status: 'ok',
    version: '2.0.0-alpha.1',
    protocol: 'UMP',
    timestamp: new Date().toISOString(),
  }));

  // ── API Routes ──
  await app.register(agentRoutes, { prefix: '/ump/v2' });
  await app.register(walletRoutes, { prefix: '/ump/v2' });
  await app.register(transactionRoutes, { prefix: '/ump/v2' });
  await app.register(contractRoutes, { prefix: '/ump/v2' });
  await app.register(auditRoutes, { prefix: '/ump/v2' });
  await app.register(disputeRoutes, { prefix: '/ump/v2' });

  return app;
}

async function start() {
  const app = await build();

  try {
    await app.listen({ port: PORT, host: HOST });
    app.log.info(`
╔═══════════════════════════════════════════════════╗
║  UMP Server v2.0.0-alpha.1                        ║
║  The Payment Rail for the Autonomous Economy      ║
║                                                   ║
║  API:  http://${HOST}:${PORT}/ump/v2              ║
║  Docs: http://${HOST}:${PORT}/docs                ║
╚═══════════════════════════════════════════════════╝
    `);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

export { build };
start();
