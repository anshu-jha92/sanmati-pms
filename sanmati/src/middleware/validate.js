import { ApiError } from '../utils/http.js';

/**
 * validate({ body, query, params }) — each is an optional Zod schema.
 * Parsed results replace the original source so downstream code uses typed, coerced values.
 */
export function validate({ body, query, params } = {}) {
  return (req, _res, next) => {
    try {
      if (params) req.params = params.parse(req.params);
      if (query) req.query = query.parse(req.query);
      if (body) req.body = body.parse(req.body);
      next();
    } catch (err) {
      if (err.issues) {
        return next(
          ApiError.badRequest('Validation failed', {
            code: 'E_VALIDATION',
            details: err.issues.map((i) => ({
              path: i.path.join('.'),
              message: i.message,
              code: i.code,
            })),
          })
        );
      }
      next(err);
    }
  };
}
