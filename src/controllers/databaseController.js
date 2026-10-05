import mongoose from 'mongoose';
import { dbState, isDbConnected } from '../config/db.js';
import { getDemoDatabase } from '../services/demoData.js';
import { ok } from '../utils/response.js';

const unavailable = () => ({
  status: dbState.status, // not_configured | connecting | disconnected
  configured: dbState.configured,
  lastConnectedAt: dbState.lastConnectedAt,
  lastFailureAt: dbState.lastFailureAt,
  lastError: dbState.lastError,
});

export async function getDatabaseHealth(req, res) {
  if (req.query.demo === '1') return ok(res, getDemoDatabase(), { simulated: true });
  if (!isDbConnected()) return ok(res, unavailable(), { simulated: false });

  try {
    const db = mongoose.connection.db;
    const t0 = process.hrtime.bigint();
    await db.admin().ping();
    const latencyMs = Math.round((Number(process.hrtime.bigint() - t0) / 1e6) * 10) / 10;

    const [stats, collections, build] = await Promise.all([
      db.stats(),
      db.listCollections({}, { nameOnly: true }).toArray(),
      db.admin().buildInfo().catch(() => ({})),
    ]);
    const collectionList = await Promise.all(
      collections.slice(0, 20).map(async (c) => ({
        name: c.name,
        documents: await db.collection(c.name).estimatedDocumentCount().catch(() => null),
      }))
    );
    const uptimeSec = dbState.connectedAt ? Math.round((Date.now() - Date.parse(dbState.connectedAt)) / 1000) : 0;

    return ok(
      res,
      {
        status: 'connected',
        configured: true,
        name: db.databaseName,
        latencyMs,
        serverStatus: 'ok',
        version: build.version ?? null,
        collections: collections.length,
        documents: stats.objects,
        indexes: stats.indexes,
        dataSizeBytes: stats.dataSize,
        storageSizeBytes: stats.storageSize,
        connectionUptimeSec: uptimeSec,
        lastConnectedAt: dbState.lastConnectedAt,
        lastFailureAt: dbState.lastFailureAt,
        lastError: dbState.lastError,
        collectionList,
      },
      { simulated: false }
    );
  } catch (err) {
    dbState.lastFailureAt = new Date().toISOString();
    dbState.lastError = `${err.name}: ${String(err.message).slice(0, 200)}`;
    return ok(res, { ...unavailable(), status: 'degraded' }, { simulated: false });
  }
}
