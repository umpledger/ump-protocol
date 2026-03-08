import { FastifyRequest, FastifyReply } from 'fastify';

/**
 * API Key Authentication Middleware
 *
 * Validates the X-API-Key header against stored keys.
 * In production, this checks against the api_keys table with bcrypt.
 * For alpha, accepts any key with the "ump_sk_" prefix.
 */
export async function authMiddleware(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  // Skip auth for health check and docs
  const publicPaths = ['/health', '/docs', '/favicon.ico'];
  if (publicPaths.some(p => request.url.startsWith(p))) return;

  const apiKey = request.headers['x-api-key'] as string;

  if (!apiKey) {
    reply.code(401).send({
      error: 'AUTHENTICATION_REQUIRED',
      message: 'Missing X-API-Key header. Get your key at https://umpledger.com/keys',
      docs: 'https://docs.umpledger.com/',
    });
    return;
  }

  const prefix = process.env.API_KEY_PREFIX || 'ump_sk_';
  if (!apiKey.startsWith(prefix)) {
    reply.code(401).send({
      error: 'INVALID_API_KEY',
      message: `API key must start with "${prefix}". Get your key at https://umpledger.com/keys`,
    });
    return;
  }

  // TODO: In production, verify against api_keys table:
  // const keyHash = await bcrypt.hash(apiKey);
  // const row = await db.query('SELECT * FROM api_keys WHERE key_hash = $1 AND active = true', [keyHash]);
  // if (!row) return reply.code(401).send({ error: 'INVALID_API_KEY' });

  // Attach key info to request for downstream use
  (request as any).apiKeyId = apiKey;
}
