// apps/api/src/services/rateLimiter.service.js
// Rate limiting service for bulk SMS sending

const { getRedisClient } = require('../lib/redis');
const pino = require('pino');

const logger = pino({ name: 'rate-limiter-service' });

// Rate limit configuration
const RATE_LIMIT_CONFIG = {
  // Per-traffic-account limits (requests per second)
  TRAFFIC_ACCOUNT_MAX: Number(process.env.RATE_LIMIT_TRAFFIC_ACCOUNT_MAX || 100),
  TRAFFIC_ACCOUNT_WINDOW: Number(process.env.RATE_LIMIT_TRAFFIC_ACCOUNT_WINDOW_MS || 1000),
  
  // Per-tenant limits (requests per second)
  TENANT_MAX: Number(process.env.RATE_LIMIT_TENANT_MAX || 50),
  TENANT_WINDOW: Number(process.env.RATE_LIMIT_TENANT_WINDOW_MS || 1000),
  
  // Global fallback limit
  GLOBAL_MAX: Number(process.env.RATE_LIMIT_GLOBAL_MAX || 200),
  GLOBAL_WINDOW: Number(process.env.RATE_LIMIT_GLOBAL_WINDOW_MS || 1000)
};

/**
 * Check if a request should be rate limited
 * Uses Redis for distributed rate limiting across multiple workers
 * 
 * @param {string} key - Rate limit key (e.g., 'traffic_account:xxx' or 'tenant:xxx')
 * @param {number} maxRequests - Maximum requests allowed in window
 * @param {number} windowMs - Time window in milliseconds
 * @returns {Promise<{allowed: boolean, remaining: number, resetAt: number}>}
 */
async function checkRateLimit(key, maxRequests, windowMs) {
  const redis = getRedisClient();
  
  if (!redis) {
    // If Redis is not available, allow the request (fallback to permissive)
    logger.warn({ key }, 'Redis not available, allowing request (rate limit disabled)');
    return { allowed: true, remaining: maxRequests, resetAt: Date.now() + windowMs };
  }

  try {
    const now = Date.now();
    const windowStart = Math.floor(now / windowMs) * windowMs;
    const redisKey = `rate_limit:${key}:${windowStart}`;
    
    // Increment counter and get current count
    const current = await redis.incr(redisKey);
    
    // Set expiration to window duration + 1 second (cleanup)
    await redis.expire(redisKey, Math.ceil(windowMs / 1000) + 1);
    
    const remaining = Math.max(0, maxRequests - current);
    const resetAt = windowStart + windowMs;
    
    const allowed = current <= maxRequests;
    
    if (!allowed) {
      logger.warn({ 
        key, 
        current, 
        maxRequests, 
        windowMs,
        resetAt: new Date(resetAt).toISOString()
      }, 'Rate limit exceeded');
    }
    
    return { allowed, remaining, resetAt };
  } catch (err) {
    // On error, allow the request (fail open)
    logger.error({ key, err: err.message }, 'Rate limit check failed, allowing request');
    return { allowed: true, remaining: maxRequests, resetAt: Date.now() + windowMs };
  }
}

/**
 * Wait until rate limit allows the request
 * 
 * @param {string} key - Rate limit key
 * @param {number} maxRequests - Maximum requests allowed
 * @param {number} windowMs - Time window in milliseconds
 * @param {number} maxWaitMs - Maximum time to wait (default: 5000ms)
 * @returns {Promise<{allowed: boolean, waited: number}>}
 */
async function waitForRateLimit(key, maxRequests, windowMs, maxWaitMs = 5000) {
  const startTime = Date.now();
  
  while (Date.now() - startTime < maxWaitMs) {
    const check = await checkRateLimit(key, maxRequests, windowMs);
    
    if (check.allowed) {
      return { allowed: true, waited: Date.now() - startTime };
    }
    
    // Wait until reset time (or 100ms, whichever is shorter)
    const waitTime = Math.min(check.resetAt - Date.now(), 100);
    if (waitTime > 0) {
      await new Promise(resolve => setTimeout(resolve, waitTime));
    }
  }
  
  // Timeout - reject the request
  logger.warn({ key, maxWaitMs }, 'Rate limit wait timeout');
  return { allowed: false, waited: Date.now() - startTime };
}

/**
 * Check per-traffic-account rate limit
 * 
 * @param {string} trafficAccountId - Traffic account ID
 * @returns {Promise<{allowed: boolean, remaining: number, resetAt: number}>}
 */
async function checkTrafficAccountLimit(trafficAccountId) {
  if (!trafficAccountId) {
    // No traffic account ID - allow (shouldn't happen, but fail open)
    return { allowed: true, remaining: RATE_LIMIT_CONFIG.TRAFFIC_ACCOUNT_MAX, resetAt: Date.now() + RATE_LIMIT_CONFIG.TRAFFIC_ACCOUNT_WINDOW };
  }
  
  const key = `traffic_account:${trafficAccountId}`;
  return await checkRateLimit(
    key,
    RATE_LIMIT_CONFIG.TRAFFIC_ACCOUNT_MAX,
    RATE_LIMIT_CONFIG.TRAFFIC_ACCOUNT_WINDOW
  );
}

/**
 * Check per-tenant rate limit
 * 
 * @param {number} ownerId - Tenant/owner ID
 * @returns {Promise<{allowed: boolean, remaining: number, resetAt: number}>}
 */
async function checkTenantLimit(ownerId) {
  if (!ownerId) {
    // No owner ID - allow (shouldn't happen, but fail open)
    return { allowed: true, remaining: RATE_LIMIT_CONFIG.TENANT_MAX, resetAt: Date.now() + RATE_LIMIT_CONFIG.TENANT_WINDOW };
  }
  
  const key = `tenant:${ownerId}`;
  return await checkRateLimit(
    key,
    RATE_LIMIT_CONFIG.TENANT_MAX,
    RATE_LIMIT_CONFIG.TENANT_WINDOW
  );
}

/**
 * Check both traffic account and tenant limits
 * Request is allowed only if both limits allow it
 * 
 * @param {string} trafficAccountId - Traffic account ID
 * @param {number} ownerId - Tenant/owner ID
 * @returns {Promise<{allowed: boolean, trafficAccountLimit: Object, tenantLimit: Object}>}
 */
async function checkAllLimits(trafficAccountId, ownerId) {
  const [trafficAccountLimit, tenantLimit] = await Promise.all([
    checkTrafficAccountLimit(trafficAccountId),
    checkTenantLimit(ownerId)
  ]);
  
  const allowed = trafficAccountLimit.allowed && tenantLimit.allowed;
  
  if (!allowed) {
    logger.warn({
      trafficAccountId,
      ownerId,
      trafficAccountAllowed: trafficAccountLimit.allowed,
      tenantAllowed: tenantLimit.allowed,
      trafficAccountRemaining: trafficAccountLimit.remaining,
      tenantRemaining: tenantLimit.remaining
    }, 'Rate limit check failed');
  }
  
  return {
    allowed,
    trafficAccountLimit,
    tenantLimit
  };
}

/**
 * Wait for rate limits to allow the request
 * 
 * @param {string} trafficAccountId - Traffic account ID
 * @param {number} ownerId - Tenant/owner ID
 * @param {number} maxWaitMs - Maximum time to wait
 * @returns {Promise<{allowed: boolean, waited: number}>}
 */
async function waitForAllLimits(trafficAccountId, ownerId, maxWaitMs = 5000) {
  const startTime = Date.now();
  
  while (Date.now() - startTime < maxWaitMs) {
    const check = await checkAllLimits(trafficAccountId, ownerId);
    
    if (check.allowed) {
      return { allowed: true, waited: Date.now() - startTime };
    }
    
    // Wait until the earliest reset time
    const resetAt = Math.min(
      check.trafficAccountLimit.resetAt,
      check.tenantLimit.resetAt
    );
    const waitTime = Math.min(resetAt - Date.now(), 100);
    
    if (waitTime > 0) {
      await new Promise(resolve => setTimeout(resolve, waitTime));
    }
  }
  
  // Timeout
  logger.warn({ trafficAccountId, ownerId, maxWaitMs }, 'Rate limit wait timeout');
  return { allowed: false, waited: Date.now() - startTime };
}

module.exports = {
  checkRateLimit,
  waitForRateLimit,
  checkTrafficAccountLimit,
  checkTenantLimit,
  checkAllLimits,
  waitForAllLimits,
  RATE_LIMIT_CONFIG
};

