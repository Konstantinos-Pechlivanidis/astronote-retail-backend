// apps/api/src/queues/sms.queue.js
const { Queue } = require('bullmq');
const { getRedisClient } = require('../lib/redis');

let smsQueue = null;

if (process.env.QUEUE_DISABLED === '1') {
  console.log('[SMS Queue] Disabled via QUEUE_DISABLED=1');
  module.exports = null;
} else {
  try {
    const connection = getRedisClient();
    
    if (!connection) {
      console.warn('[SMS Queue] Redis client not available, SMS queue disabled');
      module.exports = null;
    } else {

  const attempts = Number(process.env.QUEUE_ATTEMPTS || 5);
  const backoff = Number(process.env.QUEUE_BACKOFF_MS || 3000);
  const limiter = {
    max: Number(process.env.QUEUE_RATE_MAX || 20),
    duration: Number(process.env.QUEUE_RATE_DURATION_MS || 1000)
  };

  // BullMQ can work with a Redis client that connects asynchronously
  // The queue will wait for Redis to be ready before processing jobs
  smsQueue = new Queue('smsQueue', {
    connection,
    defaultJobOptions: {
      attempts,
      backoff: { type: 'exponential', delay: backoff },
      removeOnComplete: 1000,
      removeOnFail: false
    },
    limiter
  });

  console.log('[SMS Queue] Initialized (attempts=%d, backoff=%dms, limiter=%o)',
    attempts, backoff, limiter);

  // Log when queue is ready (after Redis connects)
  if (connection.status === 'ready') {
    console.log('[SMS Queue] Ready');
  } else {
    connection.once('ready', () => {
      console.log('[SMS Queue] Ready');
    });
  }
    }
  } catch (e) {
    console.warn('[SMS Queue] Initialization failed:', e.message);
    module.exports = null;
  }
}

module.exports = smsQueue;
