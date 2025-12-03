// apps/api/src/lib/redis.js
// Centralized Redis client configuration following official ioredis best practices
// 
// Note: This uses ioredis (not the 'redis' package). ioredis is required by BullMQ.
// With lazyConnect: true, the client connects automatically on first command.
const IORedis = require('ioredis');

/**
 * Build Redis connection options from environment variables.
 * Supports both individual env vars and REDIS_URL fallback.
 * 
 * Environment variables:
 * - REDIS_HOST (default: localhost)
 * - REDIS_PORT (default: 6379)
 * - REDIS_USERNAME (optional)
 * - REDIS_PASSWORD (optional)
 * - REDIS_DB (default: 0)
 * - REDIS_TLS (true/false, default: false)
 * - REDIS_URL (fallback, format: redis://[username]:[password]@host:port[/db])
 */
function buildRedisConfig() {
  // If REDIS_URL is provided, use it directly (most common for cloud providers)
  if (process.env.REDIS_URL && process.env.REDIS_URL !== 'disabled') {
    return {
      url: process.env.REDIS_URL,
      // Connection options
      maxRetriesPerRequest: null, // Allow unlimited retries (BullMQ requirement)
      lazyConnect: true, // Connect on first command, not immediately
      retryStrategy: (times) => {
        // Exponential backoff with max 2s delay
        const delay = Math.min(times * 50, 2000);
        return delay;
      },
      reconnectOnError: (err) => {
        // Reconnect on READONLY errors (common in Redis Cluster failover)
        const targetError = 'READONLY';
        if (err.message.includes(targetError)) {
          return true;
        }
        return false;
      },
      // Connection timeout (10 seconds)
      connectTimeout: 10000,
      // Enable keep-alive
      keepAlive: 30000
    };
  }

  // Build config from individual environment variables (fallback)
  const host = process.env.REDIS_HOST || 'localhost';
  const port = Number(process.env.REDIS_PORT || 6379);
  const username = process.env.REDIS_USERNAME || undefined;
  const password = process.env.REDIS_PASSWORD || undefined;
  const db = Number(process.env.REDIS_DB || 0);
  const tls = process.env.REDIS_TLS === 'true' || process.env.REDIS_TLS === '1';

  const config = {
    host,
    port,
    db,
    // Connection options
    maxRetriesPerRequest: null, // Allow unlimited retries (BullMQ requirement)
    lazyConnect: true, // Connect on first command, not immediately
    retryStrategy: (times) => {
      // Exponential backoff with max 2s delay
      const delay = Math.min(times * 50, 2000);
      return delay;
    },
    reconnectOnError: (err) => {
      // Reconnect on READONLY errors (common in Redis Cluster failover)
      const targetError = 'READONLY';
      if (err.message.includes(targetError)) {
        return true;
      }
      return false;
    },
    // Connection timeout (10 seconds)
    connectTimeout: 10000,
    // Enable keep-alive
    keepAlive: 30000
  };

  if (username) {
    config.username = username;
  }
  if (password) {
    config.password = password;
  }
  if (tls) {
    config.tls = {}; // TLS enabled (no cert validation for cloud providers)
  }

  return config;
}

let redisClient = null;
let isEnabled = false;

/**
 * Get or create the singleton Redis client instance.
 * Returns null if Redis is disabled or connection fails.
 */
function getRedisClient() {
  if (redisClient) {
    return redisClient;
  }

  const config = buildRedisConfig();
  
  // Check if Redis is explicitly disabled
  if (process.env.REDIS_URL === 'disabled' || !config) {
    return null;
  }

  try {
    if (config.url) {
      redisClient = new IORedis(config.url, {
        maxRetriesPerRequest: config.maxRetriesPerRequest,
        lazyConnect: config.lazyConnect,
        retryStrategy: config.retryStrategy,
        reconnectOnError: config.reconnectOnError,
        connectTimeout: config.connectTimeout,
        keepAlive: config.keepAlive
      });
    } else {
      redisClient = new IORedis(config);
    }

    redisClient.on('error', (err) => {
      console.warn('[Redis] connection error:', err.message);
      isEnabled = false;
    });

    redisClient.on('connect', () => {
      console.log('[Redis] connecting...');
      // Don't set isEnabled yet, wait for 'ready'
    });

    redisClient.on('ready', () => {
      console.log('[Redis] ready');
      isEnabled = true;
    });

    redisClient.on('close', () => {
      console.warn('[Redis] connection closed');
      isEnabled = false;
    });

    // With lazyConnect: true, ioredis connects automatically on first command
    // No need to call connect() explicitly - the connection is established
    // when the first Redis command is executed (e.g., GET, SET, etc.)
    // This allows the client to be returned immediately without blocking

    return redisClient;
  } catch (err) {
    console.warn('[Redis] initialization failed:', err.message);
    return null;
  }
}

/**
 * Check if Redis is enabled and connected.
 */
function isRedisEnabled() {
  return isEnabled && redisClient && redisClient.status === 'ready';
}

/**
 * Gracefully close Redis connection.
 * Should be called during application shutdown.
 */
async function closeRedis() {
  if (redisClient) {
    try {
      await redisClient.quit();
      redisClient = null;
      isEnabled = false;
      console.log('[Redis] connection closed gracefully');
    } catch (err) {
      console.warn('[Redis] error during close:', err.message);
    }
  }
}

module.exports = {
  getRedisClient,
  isRedisEnabled,
  closeRedis
};

