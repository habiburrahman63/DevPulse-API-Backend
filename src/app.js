import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import cors from 'cors';
import express from 'express';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import { env, isOriginAllowed } from './config/env.js';
import { errorHandler, notFound } from './middleware/errorHandler.js';
import { requestMetrics } from './middleware/requestMetrics.js';
import routes from './routes/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Each blocked origin is reported once; a dashboard that polls every few seconds would
// otherwise flood the log with the same line.
const reportedOrigins = new Map();
const REPORT_AFTER = 5;

function warnBlockedOrigin(origin) {
  if (!origin) return;
  const count = (reportedOrigins.get(origin) ?? 0) + 1;
  reportedOrigins.set(origin, count);
  if (count !== 1 && count % REPORT_AFTER !== 0) return;
  const suffix = count > 1 ? ` (blocked ${count} times)` : '';
  console.warn(`[cors] Blocked request from origin "${origin}"${suffix}. Add it to CLIENT_ORIGIN. Currently allowed: ${env.clientOrigins.join(', ')}`);
}

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  if (env.isProduction) app.set('trust proxy', 1);

  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
          fontSrc: ["'self'", 'https://fonts.gstatic.com'],
          imgSrc: ["'self'", 'data:'],
          ...(env.isProduction ? {} : { upgradeInsecureRequests: null }),
        },
      },
    })
  );
  app.use(
    cors({
      origin(origin, cb) {
        if (isOriginAllowed(origin)) return cb(null, true);
        // A rejected origin still receives a 200 with no Access-Control-Allow-Origin header,
        // which the browser reports as "blocked by CORS policy". Log it so the cause is
        // visible in the server log instead of only in the browser console.
        warnBlockedOrigin(origin);
        return cb(null, false);
      },
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization'],
      maxAge: 600,
    })
  );
  app.use(express.json({ limit: '100kb' }));
  app.use(requestMetrics);
  app.use(
    '/api',
    rateLimit({
      windowMs: 60 * 1000,
      limit: 600,
      standardHeaders: 'draft-7',
      legacyHeaders: false,
      message: { success: false, message: 'Too many requests. Slow down.', code: 'RATE_LIMITED' },
    })
  );
  app.use('/api', routes);
  app.use('/api', notFound);

  // In production the API can also serve the built frontend (single-service deployment).
  const clientDist = path.resolve(__dirname, '../../client/dist');
  if (env.isProduction && fs.existsSync(clientDist)) {
    // Vite emits content-hashed filenames under /assets, so those are safe to cache forever.
    // index.html must never be cached, or clients would keep loading stale asset references.
    app.use(express.static(clientDist, {
      index: false,
      setHeaders(res, filePath) {
        if (filePath.includes(`${path.sep}assets${path.sep}`)) {
          res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        } else {
          res.setHeader('Cache-Control', 'no-cache');
        }
      },
    }));
    app.get(/^\/(?!api\/).*/, (_req, res) => {
      res.setHeader('Cache-Control', 'no-cache');
      res.sendFile(path.join(clientDist, 'index.html'));
    });
  }

  app.use(notFound);
  app.use(errorHandler);
  return app;
}
