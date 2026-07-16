export class ApiError extends Error {
  constructor(statusCode, message, { code, details } = {}) {
    super(message);
    this.statusCode = statusCode;
    this.code = code || `E_${statusCode}`;
    this.details = details;
    this.isOperational = true;
  }
  static badRequest(msg, opts) { return new ApiError(400, msg, opts); }
  static unauthorized(msg = 'Unauthorized', opts) { return new ApiError(401, msg, opts); }
  static forbidden(msg = 'Forbidden', opts) { return new ApiError(403, msg, opts); }
  static notFound(msg = 'Not found', opts) { return new ApiError(404, msg, opts); }
  static conflict(msg, opts) { return new ApiError(409, msg, opts); }
  static tooMany(msg = 'Too many requests', opts) { return new ApiError(429, msg, opts); }
  static internal(msg = 'Internal error', opts) { return new ApiError(500, msg, opts); }
}

export function ok(data, meta) {
  return { ok: true, data, ...(meta ? { meta } : {}) };
}

export function asyncHandler(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}
