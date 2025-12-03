// apps/api/src/queues/contactImport.queue.js
const { Queue } = require('bullmq');
const { getRedisClient } = require('../lib/redis');

if (process.env.QUEUE_DISABLED === '1') {
  console.log('[Contact Import Queue] Disabled via QUEUE_DISABLED=1');
  module.exports = null;
} else {

const connection = getRedisClient();

if (!connection) {
  console.warn('[Contact Import Queue] Redis client not available, contact import queue disabled');
  module.exports = null;
} else {

const contactImportQueue = new Queue('contactImportQueue', {
  connection,
  defaultJobOptions: {
    removeOnComplete: {
      age: 3600, // Keep completed jobs for 1 hour
      count: 100, // Keep last 100 completed jobs
    },
    removeOnFail: {
      age: 86400, // Keep failed jobs for 24 hours
    },
  },
});

// Log when queue is ready
if (connection.status === 'ready') {
  console.log('[Contact Import Queue] Ready');
} else {
  connection.once('ready', () => {
    console.log('[Contact Import Queue] Ready');
  });
}

module.exports = contactImportQueue;
  }
}
