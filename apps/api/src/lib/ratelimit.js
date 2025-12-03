// apps/api/src/lib/ratelimit.js
// Rate limiting using rate-limiter-flexible
// 
// Key naming convention: `rl:{scope}:{key}`
//   - IP-based: `rl:{scope}:ip:{ipAddress}`
//   - Custom: `rl:{scope}:{customKey}`
//
// Falls back to in-memory limiter if Redis is unavailable (dev mode).
// In production, Redis is required for multi-instance deployments.
const { RateLimiterRedis, RateLimiterMemory } = require('rate-limiter-flexible');
const { getRedisClient, isRedisEnabled } = require('./redis');

const redis = getRedisClient();

/**
 * Create a rate limiter with Redis if available, else in-memory (per-process).
 * 
 * @param {Object} options
 * @param {string} options.keyPrefix - Prefix for Redis keys (e.g., 'rl:login:ip')
 * @param {number} options.points - Maximum number of points (requests) allowed
 * @param {number} options.duration - Time window in seconds
 * @param {number} [options.blockDuration=0] - Seconds to block after exceeding limit
 * @param {boolean} [options.insuranceLimiter=true] - Use in-memory fallback if Redis fails
 * @returns {RateLimiterRedis|RateLimiterMemory} Rate limiter instance
 */
function createLimiter({ keyPrefix, points, duration, blockDuration = 0, insuranceLimiter = true }) {
  // Check if Redis is available (but don't require it to be connected yet)
  // The limiter will handle connection errors gracefully
  if (redis && (isRedisEnabled() || process.env.NODE_ENV !== 'production')) {
    const redisLimiter = new RateLimiterRedis({
      storeClient: redis,
      keyPrefix,
      points,
      duration,
      blockDuration, // seconds to block when consumed more than points
      execEvenly: false, // Don't spread requests evenly - allow bursts
      insuranceLimiter: insuranceLimiter
        ? new RateLimiterMemory({ 
            keyPrefix: `${keyPrefix}:mem`, 
            points, 
            duration 
          })
        : undefined
    });
    return redisLimiter;
  }
  // Fallback for dev (not suitable for multi-instance prod by itself)
  return new RateLimiterMemory({ 
    keyPrefix: `${keyPrefix}:mem`, 
    points, 
    duration 
  });
}

/**
 * Middleware factory: limit by IP.
 */
function rateLimitByIp(limiter) {
  return async function (req, res, next) {
    try {
      const key = req.ip || req.headers['x-forwarded-for'] || 'unknown';
      await limiter.consume(key);
      return next();
    } catch (rl) {
      const ms = rl?.msBeforeNext ?? 60_000;
      res.set('Retry-After', Math.ceil(ms / 1000));
      return res.status(429).json({ message: 'Too many requests' });
    }
  };
}

/**
 * Middleware factory: limit by custom key (e.g. email, token).
 * keyFn(req) should return a string key.
 */
function rateLimitByKey(limiter, keyFn) {
  return async function (req, res, next) {
    try {
      const key = String(keyFn(req) || req.ip || 'unknown');
      await limiter.consume(key);
      return next();
    } catch (rl) {
      const ms = rl?.msBeforeNext ?? 60_000;
      res.set('Retry-After', Math.ceil(ms / 1000));
      return res.status(429).json({ message: 'Too many requests' });
    }
  };
}

module.exports = { createLimiter, rateLimitByIp, rateLimitByKey };
