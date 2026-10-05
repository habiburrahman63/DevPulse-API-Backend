export class AppError extends Error {
  constructor(message, status = 500, code = 'INTERNAL_ERROR', details) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

const DB_ERROR_NAMES = new Set([
  'MongoNotConnectedError',
  'MongooseServerSelectionError',
  'MongoServerSelectionError',
  'MongoNetworkError',
  'MongoNetworkTimeoutError',
]);

export function notFound(req, _res, next) {
  next(new AppError(`Route not found: ${req.method} ${req.originalUrl.split('?')[0]}`, 404, 'NOT_FOUND'));
}

function normalize(err) {
  if (err instanceof AppError) return err;
  if (err.type === 'entity.parse.failed') return new AppError('Request body contains invalid JSON.', 400, 'INVALID_JSON');
  if (err.type === 'entity.too.large') return new AppError('Request body is too large.', 413, 'PAYLOAD_TOO_LARGE');
  if (err.name === 'ValidationError' && err.errors) {
    const details = Object.fromEntries(Object.entries(err.errors).map(([k, v]) => [k, v.message]));
    return new AppError('Validation failed.', 422, 'VALIDATION_ERROR', details);
  }
  if (err.name === 'CastError') return new AppError('Invalid identifier.', 400, 'INVALID_ID');
  if (err.code === 11000) return new AppError('A record with these details already exists.', 409, 'DUPLICATE');
  if (DB_ERROR_NAMES.has(err.name) || /before initial connection|buffering timed out/i.test(err.message || '')) {
    return new AppError('The database is currently unavailable. Try again shortly.', 503, 'DATABASE_UNAVAILABLE');
  }
  if (err.name === 'TokenExpiredError') return new AppError('Your session has expired. Sign in again.', 401, 'TOKEN_EXPIRED');
  if (err.name === 'JsonWebTokenError' || err.name === 'NotBeforeError') return new AppError('Invalid authentication token.', 401, 'TOKEN_INVALID');
  return null;
}

// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, _next) {
  const known = normalize(err);
  if (!known) console.error(`[error] ${req.method} ${req.originalUrl}`, err);
  const e = known ?? new AppError('Something went wrong on the server.', 500, 'INTERNAL_ERROR');
  res.status(e.status).json({ success: false, message: e.message, code: e.code, ...(e.details ? { details: e.details } : {}) });
}
