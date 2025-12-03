// scripts/migrate.js
// Smart migration script that handles shadow database issues

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

console.log('Checking migration status...\n');

try {
  // Check if there are schema changes
  const statusOutput = execSync('npx prisma migrate status', { 
    encoding: 'utf8',
    stdio: 'pipe'
  });
  
  console.log(statusOutput);
  
  if (statusOutput.includes('Database schema is up to date')) {
    console.log('\n✓ Database is up to date. Generating Prisma client...\n');
    execSync('npx prisma generate', { stdio: 'inherit' });
    console.log('\n✓ Done!');
    process.exit(0);
  }
  
  if (statusOutput.includes('following migration have not yet been applied')) {
    console.log('\n⚠️  There are pending migrations. Applying them...\n');
    execSync('npx prisma migrate deploy', { stdio: 'inherit' });
    console.log('\n✓ Migrations applied. Generating Prisma client...\n');
    execSync('npx prisma generate', { stdio: 'inherit' });
    console.log('\n✓ Done!');
    process.exit(0);
  }
  
  // If there are schema changes, try to create migration
  console.log('\n📝 Schema changes detected. Creating migration...\n');
  
  // Check if SHADOW_DATABASE_URL is set
  const envFile = path.join(__dirname, '..', '.env');
  let hasShadowDb = false;
  if (fs.existsSync(envFile)) {
    const envContent = fs.readFileSync(envFile, 'utf8');
    hasShadowDb = envContent.includes('SHADOW_DATABASE_URL');
  }
  
  if (!hasShadowDb) {
    console.log('⚠️  No SHADOW_DATABASE_URL found. This may cause issues with migrate dev.');
    console.log('   Consider setting SHADOW_DATABASE_URL in your .env file for better migration validation.\n');
  }
  
  // Try to create migration
  try {
    execSync('npx prisma migrate dev', { stdio: 'inherit' });
  } catch (error) {
    // If shadow database fails, try creating migration without applying
    console.log('\n⚠️  Shadow database issue detected. Creating migration without applying...\n');
    try {
      const timestamp = new Date().toISOString().replace(/[-:]/g, '').split('.')[0].replace('T', '');
      const migrationName = `schema_update_${timestamp}`;
      execSync(`npx prisma migrate dev --create-only --name ${migrationName}`, { stdio: 'inherit' });
      console.log('\n✓ Migration created. You can apply it using: npm run prisma:migrate:deploy\n');
      console.log('Or apply the SQL manually from: prisma/migrations/');
    } catch (err) {
      console.error('\n❌ Migration creation failed.');
      console.error('\nTo fix shadow database issues:');
      console.error('1. Set SHADOW_DATABASE_URL in your .env file (optional, for validation)');
      console.error('2. Or use: npm run prisma:migrate:deploy (for production)');
      console.error('3. Or use: npx prisma db push (for development, bypasses migrations)\n');
      process.exit(1);
    }
  }
  
  execSync('npx prisma generate', { stdio: 'inherit' });
  console.log('\n✓ Done!');
  
} catch (error) {
  // If migrate status fails, try to generate client anyway
  console.error('Error checking migration status:', error.message);
  console.log('\nGenerating Prisma client anyway...\n');
  try {
    execSync('npx prisma generate', { stdio: 'inherit' });
    console.log('\n✓ Prisma client generated.');
  } catch (genError) {
    console.error('Failed to generate Prisma client:', genError.message);
    process.exit(1);
  }
}

