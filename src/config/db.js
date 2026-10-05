import mongoose from 'mongoose';
import { env } from './env.js';

// Fail fast instead of buffering queries while the database is down.
mongoose.set('bufferCommands', false);

export const dbState = {
  configured: Boolean(env.mongoUri),
  status: env.mongoUri ? 'connecting' : 'not_configured',
  connectedAt: null,
  lastConnectedAt: null,
  lastFailureAt: null,
  lastError: null,
};

const RETRY_MS = 15000;

function sanitize(message = '') {
  return String(message).replace(/mongodb(\+srv)?:\/\/\S+/gi, '[redacted-uri]').slice(0, 240);
}

function recordFailure(err) {
  dbState.status = 'disconnected';
  dbState.connectedAt = null;
  dbState.lastFailureAt = new Date().toISOString();
  dbState.lastError = `${err?.name || 'Error'}: ${sanitize(err?.message)}`;
}

mongoose.connection.on('connected', () => {
  const now = new Date().toISOString();
  dbState.status = 'connected';
  dbState.connectedAt = now;
  dbState.lastConnectedAt = now;
});
mongoose.connection.on('disconnected', () => {
  if (dbState.status === 'connected') {
    dbState.status = 'disconnected';
    dbState.connectedAt = null;
    dbState.lastFailureAt = new Date().toISOString();
    dbState.lastError = 'Connection lost. Reconnecting automatically.';
  }
});

export async function connectDb() {
  if (!env.mongoUri) return;
  dbState.status = 'connecting';
  try {
    await mongoose.connect(env.mongoUri, { serverSelectionTimeoutMS: 5000 });
    console.log('[db] MongoDB connected');
  } catch (err) {
    recordFailure(err);
    console.error(`[db] MongoDB connection failed. Retrying in ${RETRY_MS / 1000}s. ${dbState.lastError}`);
    setTimeout(connectDb, RETRY_MS).unref();
  }
}

export const isDbConnected = () => mongoose.connection.readyState === 1;
