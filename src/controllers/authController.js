import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import User from '../models/User.js';
import { env } from '../config/env.js';
import { AppError } from '../middleware/errorHandler.js';
import { created, ok } from '../utils/response.js';

const BCRYPT_ROUNDS = 12;

const signToken = (user) =>
  jwt.sign({ userId: user.id, role: user.role }, env.jwtSecret, {
    algorithm: 'HS256',
    expiresIn: env.jwtExpiresIn,
  });

export async function register(req, res) {
  const name = req.body.name.trim();
  const email = req.body.email.trim().toLowerCase();

  if (await User.exists({ email })) {
    throw new AppError('An account with this email already exists.', 409, 'EMAIL_TAKEN');
  }
  const passwordHash = await bcrypt.hash(req.body.password, BCRYPT_ROUNDS);
  // The role is never taken from the request: new accounts are always "user".
  const user = await User.create({ name, email, passwordHash, role: 'user' });
  return created(res, { user: user.toPublic(), token: signToken(user) });
}

export async function login(req, res) {
  const email = req.body.email.trim().toLowerCase();
  const user = await User.findOne({ email }).select('+passwordHash');
  const valid = user ? await bcrypt.compare(req.body.password, user.passwordHash) : false;
  // Same message for unknown email and wrong password to prevent account enumeration.
  if (!valid) throw new AppError('Invalid email or password.', 401, 'INVALID_CREDENTIALS');
  return ok(res, { user: user.toPublic(), token: signToken(user) });
}

export async function me(req, res) {
  const user = await User.findById(req.auth.userId);
  if (!user) throw new AppError('Account no longer exists.', 401, 'USER_NOT_FOUND');
  return ok(res, { user: user.toPublic() });
}
