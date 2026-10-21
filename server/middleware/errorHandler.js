// ROADMAP: Section 6 — Backend Architecture (Error Handler Middleware)
import logger from '../utils/logger.js';

/**
 * Global error handler — catches all errors passed via next(err).
 * Logs full details internally, returns sanitized response to client.
 */
export function errorHandler(err, req, res, _next) {
  // Default to 500 if no status code set
  const statusCode = err.statusCode || 500;
  const isOperational = err.isOperational || false;

  // Log the error
  if (statusCode >= 500) {
    logger.error(
      {
        err,
        reqId: req.id,
        method: req.method,
        url: req.originalUrl,
        userId: req.userId || null,
      },
      `Unhandled error: ${err.message}`
    );
  } else {
    logger.warn(
      {
        code: err.code,
        reqId: req.id,
        method: req.method,
        url: req.originalUrl,
        userId: req.userId || null,
      },
      err.message
    );
  }

  // In production, don't leak stack traces for non-operational errors
  const isProd = process.env.NODE_ENV === 'production';

  // The stack trace stays in the server log; responses never carry it.
  res.status(statusCode).json({
    error: isOperational || !isProd ? err.message : 'Internal server error',
    code: err.code || 'INTERNAL_ERROR',
    ...(err.details && { details: err.details }),
  });
}
