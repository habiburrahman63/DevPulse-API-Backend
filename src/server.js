import mongoose from 'mongoose';
import { createApp } from './app.js';
import { connectDb } from './config/db.js';
import { env, logEnvWarnings } from './config/env.js';

logEnvWarnings();
const app = createApp();
const server = app.listen(env.port, () => {
  console.log(`[server] DevPulse API listening on http://localhost:${env.port} (${env.nodeEnv})`);
});
connectDb();

// Last-resort handlers: log and exit non-zero instead of leaving the process in an
// undefined state, so orchestrators can restart it.
process.on('unhandledRejection', (reason) => {
  console.error('[process] Unhandled promise rejection:', reason);
  shutdown('unhandledRejection');
});
process.on('uncaughtException', (err) => {
  console.error('[process] Uncaught exception:', err);
  shutdown('uncaughtException');
});

let shuttingDown = false;
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[server] ${signal} received, shutting down`);
  server.close(async () => {
    await mongoose.disconnect().catch(() => {});
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 8000).unref();
}
['SIGINT', 'SIGTERM'].forEach((s) => process.on(s, () => shutdown(s)));
