// apps/api/scripts/seed-test-credits.js
// Script to add test credits to a user account
const prisma = require('../src/lib/prisma');
const { credit } = require('../src/services/wallet.service');

const USER_EMAIL = 'kostas.pechlivanidis.dev14@gmail.com';
const TEST_CREDITS = 1000; // Add 1000 test credits

async function main() {
  try {
    console.log(`Looking up user: ${USER_EMAIL}...`);
    
    const user = await prisma.user.findUnique({
      where: { email: USER_EMAIL }
    });

    if (!user) {
      console.error(`User not found: ${USER_EMAIL}`);
      process.exit(1);
    }

    console.log(`Found user: ${user.email} (ID: ${user.id})`);
    console.log(`Adding ${TEST_CREDITS} test credits...`);

    await credit(user.id, TEST_CREDITS, {
      reason: 'test_credits_seed',
      meta: { script: 'seed-test-credits.js', timestamp: new Date().toISOString() }
    });

    const { getBalance } = require('../src/services/wallet.service');
    const newBalance = await getBalance(user.id);

    console.log(`✅ Successfully added ${TEST_CREDITS} credits`);
    console.log(`New balance: ${newBalance} credits`);
  } catch (error) {
    console.error('Error seeding credits:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();

