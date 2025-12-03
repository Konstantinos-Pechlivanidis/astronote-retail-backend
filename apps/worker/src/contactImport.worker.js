// apps/worker/src/contactImport.worker.js
require('dotenv').config();

const pino = require('pino');
const logger = pino({ name: 'contact-import-worker' });

if (process.env.QUEUE_DISABLED === '1') {
  logger.warn('Disabled via QUEUE_DISABLED=1');
  process.exit(0);
}

// Dependencies are resolved from apps/api/node_modules because worker runs with cwd=apps/api
const { Worker } = require('bullmq');
const { getRedisClient } = require('../../api/src/lib/redis');
const { processImportJob } = require('../../api/src/services/contactImport.service');

const connection = getRedisClient();

if (!connection) {
  logger.warn('Redis client could not be created, contact import worker disabled');
  process.exit(0);
}

logger.info('Starting contact import worker (Redis will connect on first use)...');

const concurrency = Number(process.env.CONTACT_IMPORT_CONCURRENCY || 1);

const worker = new Worker(
  'contactImportQueue',
  async (job) => {
    logger.info({ jobId: job.id, jobName: job.name, userId: job.data?.userId }, 'Processing contact import job');
    
    if (job.name !== 'importContacts') {
      logger.warn({ jobId: job.id, jobName: job.name }, 'Unknown job name, skipping');
      return;
    }
    
    const { userId, fileBuffer, options } = job.data || {};
    if (!userId || !fileBuffer) {
      logger.error({ jobId: job.id, jobData: job.data }, 'Missing userId or fileBuffer in job data');
      throw new Error('Missing userId or fileBuffer in job data');
    }

    try {
      // Progress callback to update job progress
      const progressCallback = (processed, total) => {
        job.updateProgress({ processed, total });
      };

      logger.info({ userId, jobId: job.id }, 'Starting contact import processing');
      
      // Convert fileBuffer to Buffer if it's not already
      let buffer;
      if (Buffer.isBuffer(fileBuffer)) {
        buffer = fileBuffer;
      } else if (fileBuffer instanceof Uint8Array) {
        buffer = Buffer.from(fileBuffer);
      } else if (typeof fileBuffer === 'string') {
        buffer = Buffer.from(fileBuffer, 'base64');
      } else {
        buffer = Buffer.from(fileBuffer);
      }
      
      const result = await processImportJob(
        { userId, fileBuffer: buffer, options },
        progressCallback
      );
      
      logger.info({ 
        userId, 
        jobId: job.id,
        created: result.created,
        skipped: result.skipped,
        errors: result.errors.length
      }, 'Contact import completed successfully');
      
      return result;
    } catch (err) {
      logger.error({ 
        userId, 
        jobId: job.id,
        error: err.message,
        stack: err.stack 
      }, 'Error processing contact import job');
      throw err; // Re-throw to mark job as failed
    }
  },
  { connection, concurrency }
);

worker.on('active', (job) => logger.info({ jobId: job.id }, `Processing ${job.name}`));
worker.on('completed', (job) => logger.info({ jobId: job.id }, `Completed ${job.name}`));
worker.on('failed', (job, err) => logger.error({ jobId: job?.id, err: err?.message }, `Failed ${job?.name}`));
worker.on('progress', (job, progress) => {
  logger.debug({ jobId: job.id, progress }, 'Import progress update');
});

