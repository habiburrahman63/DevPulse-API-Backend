import { AppError } from './errorHandler.js';
import { isDbConnected } from '../config/db.js';
import { env } from '../config/env.js';
import { isValidRange, RANGE_KEYS } from '../services/demoData.js';

export const validate = (validator) => (req, _res, next) => {
  const errors = validator(req.body);
  if (Object.keys(errors).length) return next(new AppError('Validation failed.', 422, 'VALIDATION_ERROR', errors));
  next();
};

export const requireAuthConfig = (_req, _res, next) =>
  env.authConfigured
    ? next()
    : next(new AppError('Authentication is not configured on this server.', 503, 'AUTH_NOT_CONFIGURED'));

export const requireDb = (_req, _res, next) =>
  isDbConnected()
    ? next()
    : next(new AppError('The database is currently unavailable. Try again shortly.', 503, 'DATABASE_UNAVAILABLE'));

export const validateRange = (req, _res, next) => {
  const range = req.query.range ?? '1h';
  if (!isValidRange(range)) {
    return next(new AppError(`Invalid range. Use one of: ${RANGE_KEYS.join(', ')}.`, 400, 'INVALID_RANGE'));
  }
  req.range = range;
  next();
};
