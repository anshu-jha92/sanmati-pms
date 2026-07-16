import { ApiError } from '../utils/http.js';
import { logger } from '../config/logger.js';
import { isProd } from '../config/env.js';
import { ZodError } from 'zod';

export function notFoundHandler(req, _res, next) {
  next(ApiError.notFound(`Route ${req.method} ${req.originalUrl} not found`));
}

// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, _next) {
  // Zod validation error — give the caller exact field-level errors
  if (err instanceof ZodError) {
    const details = err.errors.map((e) => ({
      path: e.path.join('.'),
      message: e.message,
      code: e.code,
    }));
    return send(res, new ApiError(400, 'Invalid payload', { code: 'E_VALIDATION', details }));
  }

  // Mongo duplicate key
  if (err?.code === 11000) {
    const field = Object.keys(err.keyValue || {})[0];
    const value = err.keyValue?.[field];
    let message = 'Duplicate value';
    let hint;

    if (field === 'externalId' && (value === null || value === undefined)) {
      message = 'Database needs migration to allow multiple records without externalId';
      hint = 'Run: node scripts/fix-po-index.js (from backend folder)';
    } else if (field) {
      message = `${field} "${value}" is already in use`;
    }

    const dup = new ApiError(409, message, {
      code: 'E_DUPLICATE',
      details: { field, value, hint },
    });
    return send(res, dup);
  }

  // Mongoose validation
  if (err?.name === 'ValidationError') {
    const details = Object.values(err.errors || {}).map((e) => ({
      path: e.path,
      message: e.message,
      kind: e.kind,
    }));
    return send(res, new ApiError(400, 'Invalid payload', { code: 'E_VALIDATION', details }));
  }

  // CastError (bad ObjectId)
  if (err?.name === 'CastError') {
    return send(res, new ApiError(400, `Invalid ${err.path}`, { code: 'E_BAD_ID' }));
  }

  if (err instanceof ApiError) return send(res, err);

  // Unknown — log and return generic in prod
  req.log?.error({ err }, 'Unhandled error') || logger.error({ err }, 'Unhandled error');
  const safe = new ApiError(500, isProd ? 'Internal error' : err.message || 'Internal error', {
    code: 'E_INTERNAL',
  });
  return send(res, safe);
}

function send(res, err) {
  res.status(err.statusCode).json({
    ok: false,
    error: {
      code: err.code,
      message: err.message,
      ...(err.details ? { details: err.details } : {}),
    },
  });
}
