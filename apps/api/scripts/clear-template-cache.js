// apps/api/scripts/clear-template-cache.js
// Clear all template-related cache entries
require('dotenv').config();
const { getRedisClient } = require('../src/lib/redis');

const redis = getRedisClient();

async function clearTemplateCache() {
  if (!redis) {
    console.log('⚠️  Redis not available - no cache to clear');
    return;
  }

  try {
    // Get all template cache keys
    const keys = await redis.keys('cache:templates:*');
    const singleKeys = await redis.keys('cache:template:*');
    const allKeys = [...keys, ...singleKeys];

    if (allKeys.length === 0) {
      console.log('✅ No template cache keys found');
      return;
    }

    // Delete all keys
    if (allKeys.length > 0) {
      await redis.del(...allKeys);
      console.log(`✅ Cleared ${allKeys.length} template cache keys`);
      console.log('   Sample keys cleared:');
      allKeys.slice(0, 5).forEach(key => console.log(`     - ${key}`));
      if (allKeys.length > 5) {
        console.log(`     ... and ${allKeys.length - 5} more`);
      }
    }
  } catch (error) {
    console.error('❌ Error clearing cache:', error.message);
    throw error;
  }
}

if (require.main === module) {
  clearTemplateCache()
    .then(() => {
      console.log('\n✅ Cache cleared successfully!');
      process.exit(0);
    })
    .catch((error) => {
      console.error('❌ Failed to clear cache:', error);
      process.exit(1);
    });
}

module.exports = { clearTemplateCache };

