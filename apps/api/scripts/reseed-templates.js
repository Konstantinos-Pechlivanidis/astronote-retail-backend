// apps/api/scripts/reseed-templates.js
// Combined script to cleanup and reseed templates (comprehensive: English + Greek)
require('dotenv').config();
const { cleanupTemplates } = require('./cleanup-templates');
const { seedTemplatesComprehensive } = require('./seed-templates-comprehensive');

async function reseedTemplates() {
  console.log('=== Reseeding System Templates ===\n');
  
  try {
    // Step 1: Cleanup old templates
    console.log('Step 1: Cleaning up old templates...\n');
    await cleanupTemplates();
    
    console.log('\n---\n');
    
    // Step 2: Seed comprehensive templates (English + Greek)
    console.log('Step 2: Seeding comprehensive templates (EN + GR)...\n');
    await seedTemplatesComprehensive();
    
    console.log('\n=== Reseeding Complete ===');
    console.log('✅ All templates have been cleaned up and reseeded.');
    console.log('✅ Templates include both English and Greek versions with i18n support.');
    
  } catch (error) {
    console.error('\n❌ Reseeding failed:', error);
    throw error;
  }
}

if (require.main === module) {
  reseedTemplates()
    .then(() => {
      process.exit(0);
    })
    .catch((error) => {
      console.error('Reseed failed:', error);
      process.exit(1);
    });
}

module.exports = { reseedTemplates };

