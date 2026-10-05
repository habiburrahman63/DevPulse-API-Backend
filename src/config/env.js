import 'dotenv/config';

// The `--production` flag (passed by the `start:prod` scripts) makes `npm start` behave
// identically on Windows, macOS and Linux, where inline `NODE_ENV=value cmd` is not portable.
const productionRequested = process.argv.includes('--production');
const nodeEnv = productionRequested ? 'production' : process.env.NODE_ENV || 'development';

const jwtSecret = process.env.JWT_SECRET || '';

// Origins are compared case-insensitively and without a trailing slash, because browsers
// send the exact scheme://host[:port] with no path. Normalising here means a value pasted
// as "https://app.vercel.app/" still matches the browser's "https://app.vercel.app".
const normalizeOrigin = (origin) => String(origin).trim().replace(/\/+$/, '').toLowerCase();

const isLocalOrigin = (o) => /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(o);

// Allowed origins come from CLIENT_ORIGIN. Hosting providers also expose the public URL of
// this API, which is derived into an origin so a single-service deploy works unchanged.
// Split hosting (Vercel frontend + Render backend) still needs CLIENT_ORIGIN, because the
// frontend origin is unrelated to the API's own URL.
const configuredOrigins = (process.env.CLIENT_ORIGIN || '')
  .split(',')
  .map(normalizeOrigin)
  .filter(Boolean);

const derivedOrigins = [
  process.env.PUBLIC_URL,
  process.env.RENDER_EXTERNAL_URL,
]
  .filter(Boolean)
  .flatMap((value) => {
    try {
      return [normalizeOrigin(new URL(value).origin)];
    } catch {
      return [];
    }
  });

const clientOrigins = [...new Set([...configuredOrigins, ...derivedOrigins])];

// Set when CLIENT_ORIGIN was never configured, so the warning below can say so precisely.
const originsUnconfigured = configuredOrigins.length === 0;

export const env = Object.freeze({
  nodeEnv,
  isProduction: nodeEnv === 'production',
  port: Number(process.env.PORT) || 5000,
  mongoUri: process.env.MONGODB_URI || '',
  jwtSecret,
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '1d',
  // A short secret is treated as "not configured" so weak keys are never used silently.
  authConfigured: jwtSecret.length >= 32,
  clientOrigins,
  clientOriginsAllowsAll: clientOrigins.includes('*'),
  clientOriginsUnconfigured: originsUnconfigured && derivedOrigins.length === 0,
});

/**
 * Requests with no Origin header (curl, server-to-server) are not browser CORS calls.
 *
 * When no allow-list can be determined at all, the origin is reflected rather than
 * rejected. That is a deliberate availability-over-strictness trade-off: this API serves
 * read-only monitoring data plus auth, holds no cookies and sets none, so a reflected
 * origin cannot expose another visitor's session. As soon as CLIENT_ORIGIN (or a public
 * URL) is present, the allow-list is enforced strictly again.
 */
export function isOriginAllowed(origin) {
  if (!origin) return true;
  if (env.clientOriginsAllowsAll) return true;
  if (env.clientOrigins.length === 0) return true;
  return env.clientOrigins.includes(normalizeOrigin(origin));
}

export function logEnvWarnings() {
  if (!env.authConfigured) {
    console.warn('[config] JWT_SECRET is missing or shorter than 32 characters. Authentication endpoints are disabled.');
  }
  if (!env.mongoUri) {
    console.warn('[config] MONGODB_URI is not set. Database features will report "not configured".');
  }
  if (env.isProduction) {
    if (env.clientOriginsAllowsAll) {
      console.warn('[cors] CLIENT_ORIGIN is "*": every website can call this API. Use explicit origins in production.');
    } else if (env.clientOriginsUnconfigured) {
      console.warn('[cors] CLIENT_ORIGIN is not set and no public URL was detected, so any origin is currently accepted. Set CLIENT_ORIGIN on this server to restrict access to your frontend.');
    } else {
      console.log(`[cors] Allowed browser origins: ${env.clientOrigins.join(', ')}`);
      const onlyLocal = env.clientOrigins.length > 0 && env.clientOrigins.every(isLocalOrigin);
      if (onlyLocal) {
        // This exact mismatch is the most common cause of a blank dashboard in production:
        // the API answers 200 but sends no Access-Control-Allow-Origin, so the browser blocks it.
        console.warn('[cors] CLIENT_ORIGIN only lists local addresses. Add your deployed frontend origin, otherwise the browser will block every API call from it.');
      }
    }
  }
}
