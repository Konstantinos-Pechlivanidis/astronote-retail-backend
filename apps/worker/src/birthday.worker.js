// apps/worker/src/birthday.worker.js
// Daily worker for birthday message automations

require('dotenv').config();

const pino = require('pino');
const logger = pino({ name: 'birthday-worker' });

if (process.env.QUEUE_DISABLED === '1') {
  logger.warn('Disabled via QUEUE_DISABLED=1');
  process.exit(0);
}

const { getRedisClient, isRedisEnabled } = require('../../api/src/lib/redis');
const { processBirthdayAutomations } = require('../../api/src/services/automation.service');

// Check Redis availability
const connection = getRedisClient();

if (!isRedisEnabled() || !connection) {
  logger.warn('Redis not available, birthday worker disabled');
  process.exit(0);
}

/**
 * Process birthday automations
 * Should be called daily (via cron or scheduled task)
 */
async function runBirthdayAutomations() {
  try {
    logger.info('Starting birthday automations processing...');
    const result = await processBirthdayAutomations();
    logger.info({
      storesProcessed: result.storesProcessed,
      contactsProcessed: result.processed,
      messagesSent: result.sent,
      messagesFailed: result.failed
    }, 'Birthday automations completed successfully');
  } catch (err) {
    logger.error({ err: err.message, stack: err.stack }, 'Error processing birthday automations');
    throw err;
  }
}

// Run immediately on startup (for testing/manual runs)
if (process.env.RUN_BIRTHDAY_ON_START === '1') {
  runBirthdayAutomations()
    .then(() => {
      logger.info('Initial run completed');
      process.exit(0);
    })
    .catch((err) => {
      logger.error({ err }, 'Initial run failed');
      process.exit(1);
    });
} else {
  // For production, this should be called via a cron job or scheduled task
  // Example cron: 0 9 * * * (9 AM daily)
  // Or use node-cron, node-schedule, or a cloud scheduler (AWS EventBridge, etc.)
  logger.info('Started. Use RUN_BIRTHDAY_ON_START=1 for manual run, or schedule via cron.');
  
  // Keep process alive if needed for cron integration
  // For now, exit (cron will restart it)
  process.exit(0);
}

module.exports = { runBirthdayAutomations };

