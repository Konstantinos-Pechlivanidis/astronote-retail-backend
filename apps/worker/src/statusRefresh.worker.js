// apps/worker/src/statusRefresh.worker.js
require('dotenv').config();

const pino = require('pino');
const logger = pino({ name: 'status-refresh-worker' });

if (process.env.QUEUE_DISABLED === '1') {
  logger.warn('Disabled via QUEUE_DISABLED=1');
  process.exit(0);
}

// Dependencies are resolved from apps/api/node_modules because worker runs with cwd=apps/api
const { Worker } = require('bullmq');
const { getRedisClient } = require('../../api/src/lib/redis');
const { refreshPendingStatuses } = require('../../api/src/services/statusRefresh.service');

const connection = getRedisClient();

if (!connection) {
  logger.warn('Redis client could not be created, status refresh worker disabled');
  process.exit(0);
}

// With lazyConnect: true, Redis connects on first command
// BullMQ will handle the connection, so we don't need to wait for 'ready' here
logger.info('Starting status refresh worker (Redis will connect on first use)...');

const concurrency = Number(process.env.STATUS_REFRESH_CONCURRENCY || 1);

const worker = new Worker(
  'statusRefreshQueue',
  async (job) => {
    if (job.name !== 'refreshPendingStatuses') return;
    
    const { limit = 50 } = job.data || {};
    
    try {
      const result = await refreshPendingStatuses(limit);
      logger.info({ 
        limit, 
        refreshed: result.refreshed, 
        updated: result.updated, 
        errors: result.errors,
        campaignsUpdated: result.campaignsUpdated 
      }, 'Status refresh job completed');
      
      return result;
    } catch (err) {
      logger.error({ limit, err: err.message }, 'Status refresh job failed');
      throw err; // Let BullMQ handle retries
    }
  },
  { connection, concurrency }
);

worker.on('active', (job) => logger.info({ jobId: job.id }, `Processing ${job.name}`));
worker.on('completed', (job) => logger.info({ jobId: job.id }, `Completed ${job.name}`));
worker.on('failed', (job, err) => logger.error({ jobId: job?.id, err: err?.message }, `Failed ${job?.name}`));

// Handle graceful shutdown
process.on('SIGTERM', async () => {
  logger.info('SIGTERM received, closing worker...');
  await worker.close();
  process.exit(0);
});

process.on('SIGINT', async () => {
  logger.info('SIGINT received, closing worker...');
  await worker.close();
  process.exit(0);
});

