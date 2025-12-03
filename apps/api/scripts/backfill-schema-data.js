// apps/api/scripts/backfill-schema-data.js
// Script to backfill data for schema changes before applying migration

require('dotenv').config();
const prisma = require('../src/lib/prisma');

async function main() {
  console.log('Backfilling schema data...');
  
  // Use raw SQL to backfill NULL categories (Prisma doesn't allow querying NULL on required enum)
  const categoryResult = await prisma.$executeRaw`
    UPDATE "MessageTemplate" 
    SET "category" = 'generic'::"TemplateCategory" 
    WHERE "category" IS NULL
  `;
  console.log(`Updated ${categoryResult} MessageTemplate records with category = 'generic'`);
  
  console.log('Backfill complete!');
  console.log('Note: Automation fields will be added with defaults when schema is pushed.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

