import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { env } from '../config/env.js';
import { authenticate } from '../middleware/auth.js';
import { requireAuthConfig, requireDb, validate, validateRange } from '../middleware/validate.js';
import { validateLogin, validateRegister } from '../utils/validators.js';
import * as auth from '../controllers/authController.js';
import * as monitor from '../controllers/monitorController.js';
import { getDatabaseHealth } from '../controllers/databaseController.js';
import { ok } from '../utils/response.js';

// Express 4 does not catch rejected promises from async handlers on its own.
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { success: false, message: 'Too many attempts. Try again in a few minutes.', code: 'RATE_LIMITED' },
});

const router = Router();

router.get('/health', (_req, res) =>
  ok(res, { status: 'ok', service: 'devpulse-api', environment: env.nodeEnv, uptimeSec: Math.round(process.uptime()), timestamp: new Date().toISOString() })
);

router.post('/auth/register', authLimiter, requireAuthConfig, validate(validateRegister), requireDb, wrap(auth.register));
router.post('/auth/login', authLimiter, requireAuthConfig, validate(validateLogin), requireDb, wrap(auth.login));
router.get('/auth/me', requireAuthConfig, authenticate, requireDb, wrap(auth.me));

router.get('/database/health', wrap(getDatabaseHealth));

router.get('/monitor/summary', validateRange, monitor.summary);
router.get('/monitor/endpoints', validateRange, monitor.endpoints);
router.get('/monitor/performance', validateRange, monitor.performance);
router.get('/monitor/errors', monitor.errors);
router.get('/monitor/activity', monitor.activity);
router.get('/monitor/system', monitor.system);
router.get('/monitor/notifications', monitor.notifications);

export default router;
