// Test script to verify audience calculation
require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const { buildAudience } = require('../src/services/audience.service');

const prisma = new PrismaClient();

async function testAudience() {
  try {
    // Get first user
    const user = await prisma.user.findFirst({
      select: { id: true, email: true }
    });
    
    if (!user) {
      console.log('❌ No users found in database');
      process.exit(1);
    }
    
    console.log(`\n📊 Testing audience calculation for user ID: ${user.id} (${user.email})\n`);
    
    // Get all contacts for this user
    const allContacts = await prisma.contact.findMany({
      where: { ownerId: user.id },
      select: {
        id: true,
        phone: true,
        isSubscribed: true,
        gender: true,
        birthday: true,
        firstName: true,
        lastName: true
      }
    });
    
    console.log(`📇 Total contacts for user: ${allContacts.length}`);
    console.log(`   - Subscribed: ${allContacts.filter(c => c.isSubscribed).length}`);
    console.log(`   - With birthday: ${allContacts.filter(c => c.birthday).length}`);
    console.log(`   - With gender: ${allContacts.filter(c => c.gender).length}`);
    
    if (allContacts.length === 0) {
      console.log('\n⚠️  No contacts found. Please create at least one contact first.');
      process.exit(0);
    }
    
    // Test different filters
    console.log('\n🔍 Testing audience filters:\n');
    
    // All contacts
    const allAudience = await buildAudience(user.id, null, null, null);
    console.log(`✅ All contacts (no filters): ${allAudience.length}`);
    
    // By gender
    const genders = ['male', 'female', 'other', 'prefer_not_to_say'];
    for (const gender of genders) {
      const audience = await buildAudience(user.id, gender, null, null);
      console.log(`✅ Gender: ${gender}: ${audience.length}`);
    }
    
    // By age group
    const ageGroups = ['18_24', '25_39', '40_plus'];
    for (const ageGroup of ageGroups) {
      const audience = await buildAudience(user.id, null, ageGroup, null);
      console.log(`✅ Age group: ${ageGroup}: ${audience.length}`);
    }
    
    // Combined
    const combined = await buildAudience(user.id, 'male', '18_24', null);
    console.log(`✅ Combined (male, 18-24): ${combined.length}`);
    
    console.log('\n✅ Audience calculation test complete!\n');
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    if (error.stack) {
      console.error(error.stack);
    }
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

testAudience();

