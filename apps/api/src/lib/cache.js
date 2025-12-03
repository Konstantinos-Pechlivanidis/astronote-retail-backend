// apps/api/src/lib/cache.js
// Redis cache wrapper with safe no-op fallbacks
// 
// ⚠️⚠️⚠️ CACHE DISABLED - DO NOT USE ⚠️⚠️⚠️
// 
// All caching has been removed for development and testing.
// This file remains for future re-enabling but is currently UNUSED.
// 
// NO cache calls should be made in routes or services.
// If you need caching, re-enable it properly with proper invalidation logic.
// 
// This file is kept only for reference and should NOT be imported anywhere.
//
// Key naming convention (for future reference): 
//   - Cache: `cache:{resource}:{id}` or `cache:{resource}:v{version}:{ownerId}:{id}`
//   - Stats: `stats:{resource}:v{version}:{ownerId}:{id}`
//   - Lists: `campaigns:list:v{version}:{ownerId}:{params}`
//
// TTL defaults to 30 seconds for most operations, but can be customized per call.
const { getRedisClient } = require('./redis');

const redis = getRedisClient();

/**
 * Get a value from cache
 * @param {string} key - Cache key
 * @returns {Promise<string|null>} Cached value or null if not found/error
 */
async function cacheGet(key) {
  if (!redis) {
    return null;
  }
  // Don't check isRedisEnabled() here - let the command fail gracefully
  // This allows the connection to be established on first use
  try {
    return await redis.get(key);
  } catch (err) {
    // Silently fail - cache miss is acceptable
    return null;
  }
}

/**
 * Set a value in cache with TTL
 * @param {string} key - Cache key
 * @param {string} value - Value to cache (should be JSON stringified if object)
 * @param {number} ttlSec - Time to live in seconds (default: 30)
 * @returns {Promise<boolean>} True if successful, false otherwise
 */
async function cacheSet(key, value, ttlSec = 30) {
  if (!redis) {
    return false;
  }
  try {
    // Use SET with EX option for atomic set+expire
    await redis.set(key, value, "EX", ttlSec);
    return true;
  } catch (err) {
    // Silently fail - cache write failure is acceptable
    return false;
  }
}

/**
 * Delete a key from cache
 * @param {string} key - Cache key to delete
 * @returns {Promise<number>} Number of keys deleted (0 or 1)
 */
async function cacheDel(key) {
  if (!redis) {
    return 0;
  }
  try {
    return await redis.del(key);
  } catch (err) {
    // Silently fail - cache delete failure is acceptable
    return 0;
  }
}

/**
 * Delete all keys matching a prefix (uses SCAN to avoid blocking)
 * @param {string} prefix - Key prefix to match (e.g., "cache:stats:")
 * @returns {Promise<number>} Number of keys deleted
 * 
 * Note: Uses SCAN instead of KEYS to avoid blocking Redis server
 */
async function cacheDelPrefix(prefix) {
  if (!redis) {
    return 0;
  }
  let deleted = 0;
  try {
    let cursor = "0";
    do {
      // SCAN is non-blocking, unlike KEYS
      const [next, keys] = await redis.scan(
        cursor,
        "MATCH",
        `${prefix}*`,
        "COUNT",
        200 // Process 200 keys per iteration
      );
      cursor = next;
      if (keys && keys.length > 0) {
        // Delete in batch for efficiency
        const n = await redis.del(...keys);
        deleted += n;
      }
    } while (cursor !== "0");
  } catch (err) {
    // Silently fail - cache cleanup failure is acceptable
  }
  return deleted;
}

module.exports = { cacheGet, cacheSet, cacheDel, cacheDelPrefix };
