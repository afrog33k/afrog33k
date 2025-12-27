import Fastify from 'fastify';
import cors from '@fastify/cors';
import { getDb, closeDb } from './lib/db.js';
import { reportRoutes } from './routes/reports.js';
import { sourceRoutes } from './routes/sources.js';
import { telemetryRoutes } from './routes/telemetry.js';
import { visitRoutes } from './routes/visits.js';
import { conceptRoutes } from './routes/concepts.js';
import { jobRoutes } from './routes/jobs.js';
import { systemRoutes } from './routes/system.js';
import { testRoutes } from './routes/tests.js';
import briefingRoutes from './routes/briefing.js';

const PORT = parseInt(process.env.PORT || '3001');

const app = Fastify({
  logger: true,
});

// Attach database to fastify instance for routes
(app as any).db = getDb();

// CORS for web frontend
await app.register(cors, {
  origin: true,
  credentials: true,
});

// Health check
app.get('/health', async () => {
  const db = getDb();
  const result = db.prepare('SELECT 1 as ok').get() as { ok: number };
  return { status: 'ok', db: result.ok === 1 };
});

// Register routes
await app.register(reportRoutes, { prefix: '/api' });
await app.register(sourceRoutes, { prefix: '/api' });
await app.register(telemetryRoutes, { prefix: '/api' });
await app.register(visitRoutes, { prefix: '/api' });
await app.register(conceptRoutes, { prefix: '/api' });
await app.register(jobRoutes, { prefix: '/api' });
await app.register(systemRoutes, { prefix: '/api' });
await app.register(testRoutes, { prefix: '/api' });
await app.register(briefingRoutes, { prefix: '/api' });

// Error handler
app.setErrorHandler((error, request, reply) => {
  app.log.error(error);

  const statusCode = (error as any).statusCode || 500;
  const message = error.message || 'Internal Server Error';

  reply.status(statusCode).send({
    error: true,
    message,
    statusCode,
  });
});

// Graceful shutdown
const shutdown = async () => {
  app.log.info('Shutting down...');
  closeDb();
  await app.close();
  process.exit(0);
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

// Start server
try {
  await app.listen({ port: PORT, host: '0.0.0.0' });
  app.log.info(`Ronald API running on port ${PORT}`);
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
