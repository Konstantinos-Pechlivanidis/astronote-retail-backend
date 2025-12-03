// apps/api/scripts/cleanup-templates.js
// Cleanup script to remove all existing system templates and clear cache
require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const { cacheDelPrefix } = require('../src/lib/cache');

const prisma = new PrismaClient();

const SYSTEM_USER_ID = Number(process.env.SYSTEM_USER_ID || 1);

async function cleanupTemplates() {
  console.log('Cleaning up system templates...');
  console.log(`System User ID: ${SYSTEM_USER_ID}\n`);

  try {
    // Step 1: Count and delete templates
    const count = await prisma.messageTemplate.count({
      where: { ownerId: SYSTEM_USER_ID }
    });

    console.log(`Found ${count} existing system templates`);

    if (count > 0) {
      const result = await prisma.messageTemplate.deleteMany({
        where: { ownerId: SYSTEM_USER_ID }
      });
      console.log(`✅ Deleted ${result.count} system templates from database`);
    } else {
      console.log('No templates to delete from database.');
    }

    // Step 2: Clear template cache
    console.log('\nClearing template cache...');
    const cachePrefixes = [
      'cache:templates:',  // List cache
      'cache:template:'    // Individual template cache
    ];

    let totalCleared = 0;
    for (const prefix of cachePrefixes) {
      const cleared = await cacheDelPrefix(prefix);
      totalCleared += cleared;
      if (cleared > 0) {
        console.log(`✅ Cleared ${cleared} cache keys with prefix "${prefix}"`);
      }
    }

    if (totalCleared === 0) {
      console.log('✅ No template cache keys found (or cache not enabled)');
    } else {
      console.log(`✅ Total cache keys cleared: ${totalCleared}`);
    }

    console.log('\n✅ Cleanup complete!');
    console.log('You can now run the seed script to create new templates with the correct format.');

  } catch (error) {
    console.error('Error cleaning up templates:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  cleanupTemplates()
    .then(() => {
      console.log('\nDone!');
      process.exit(0);
    })
    .catch((error) => {
      console.error('Cleanup failed:', error);
      process.exit(1);
    });
}

module.exports = { cleanupTemplates };

