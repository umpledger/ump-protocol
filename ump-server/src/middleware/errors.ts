import { FastifyError, FastifyReply, FastifyRequest } from 'fastify';

/**
 * Centralized error handler.
 * Maps UMP SDK errors to proper HTTP responses.
 */
export function errorHandler(
  error: FastifyError,
  request: FastifyRequest,
  reply: FastifyReply
): void {
  const errorMap: Record<string, number> = {
    AUTHORITY_EXCEEDED: 403,
    INSUFFICIENT_FUNDS: 402,
    WALLET_FROZEN: 423,
    AGENT_NOT_FOUND: 404,
    AGENT_REVOKED: 403,
    CONTRACT_NOT_FOUND: 404,
    WALLET_NOT_FOUND: 404,
    ESCROW_NOT_FOUND: 404,
    POLICY_VIOLATION: 403,
    INVALID_RULE: 400,
    INVALID_STATE: 409,
    DISPUTE_ERROR: 409,
    VALIDATION_ERROR: 400,
  };

  const code = (error as any).code;
  const statusCode = errorMap[code] || error.statusCode || 500;

  request.log.error({
    err: error,
    statusCode,
    code,
    url: request.url,
    method: request.method,
  });

  reply.code(statusCode).send({
    error: code || 'INTERNAL_ERROR',
    message: error.message,
    statusCode,
    requestId: request.id,
    timestamp: new Date().toISOString(),
    ...(process.env.NODE_ENV !== 'production' && { stack: error.stack }),
  });
}
