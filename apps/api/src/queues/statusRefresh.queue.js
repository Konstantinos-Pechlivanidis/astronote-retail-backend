// apps/api/src/queues/statusRefresh.queue.js
const { Queue } = require('bullmq');
const { getRedisClient } = require('../lib/redis');

if (process.env.QUEUE_DISABLED === '1') {
  console.log('[Status Refresh Queue] Disabled via QUEUE_DISABLED=1');
  module.exports = null;
} else {
  const connection = getRedisClient();

  if (!connection) {
    console.warn('[Status Refresh Queue] Redis client not available, status refresh queue disabled');
    module.exports = null;
  } else {

// BullMQ can work with a Redis client that connects asynchronously
// The queue will wait for Redis to be ready before processing jobs
const statusRefreshQueue = new Queue('statusRefreshQueue', {
  connection,
  defaultJobOptions: {
    removeOnComplete: true,
    removeOnFail: false
  }
});

// Log when queue is ready (after Redis connects)
if (connection.status === 'ready') {
  console.log('[Status Refresh Queue] Ready');
} else {
  connection.once('ready', () => {
    console.log('[Status Refresh Queue] Ready');
  });
}

module.exports = statusRefreshQueue;
  }
}

