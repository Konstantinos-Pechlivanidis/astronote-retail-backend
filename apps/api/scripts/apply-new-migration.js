// apps/api/scripts/apply-new-migration.js
// Apply the new migration SQL directly to add NfcTagType and ConversionEvent

require('dotenv').config();
const prisma = require('../src/lib/prisma');
const fs = require('fs');
const path = require('path');

async function main() {
  console.log('Applying new migration for NfcTagType and ConversionEvent...');
  
  // Read the migration SQL file
  const migrationPath = path.join(__dirname, '../../../prisma/migrations/20250121000000_add_nfc_type_and_conversion_event/migration.sql');
  const migrationSQL = fs.readFileSync(migrationPath, 'utf8');
  
  // Split by semicolons and execute each statement
  const statements = migrationSQL
    .split(';')
    .map(s => s.trim())
    .filter(s => s.length > 0 && !s.startsWith('--'));
  
  for (const statement of statements) {
    try {
      if (statement.includes('CREATE TYPE') || statement.includes('CREATE TABLE') || 
          statement.includes('ALTER TABLE') || statement.includes('CREATE INDEX') ||
          statement.includes('ADD CONSTRAINT')) {
        console.log(`Executing: ${statement.substring(0, 50)}...`);
        await prisma.$executeRawUnsafe(statement);
        console.log('✓ Success');
      }
    } catch (error) {
      // Ignore errors for things that already exist
      if (error.message.includes('already exists') || 
          error.message.includes('duplicate') ||
          error.code === '42P07' || // relation already exists
          error.code === '42710') { // duplicate object
        console.log('⚠ Already exists, skipping');
      } else {
        console.error(`✗ Error: ${error.message}`);
        throw error;
      }
    }
  }
  
  console.log('Migration applied successfully!');
}

main()
  .catch((e) => {
    console.error('Migration failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

