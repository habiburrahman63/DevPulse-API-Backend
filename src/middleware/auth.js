import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { AppError } from './errorHandler.js';

export function authenticate(req, _res, next) {
  const header = req.headers.authorization || '';
  const [scheme, token] = header.split(' ');
  if (scheme !== 'Bearer' || !token) {
    return next(new AppError('Authentication required. Send a Bearer token.', 401, 'AUTH_REQUIRED'));
  }
  try {
    // Algorithms are pinned to prevent "alg: none" and algorithm-confusion attacks.
    const payload = jwt.verify(token, env.jwtSecret, { algorithms: ['HS256'] });
    req.auth = { userId: payload.userId, role: payload.role };
    next();
  } catch (err) {
    next(err);
  }
}
