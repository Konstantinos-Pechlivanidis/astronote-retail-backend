// apps/api/scripts/remove-all-templates-without-metrics.js
// Remove ALL templates that don't have any metrics (even those in use by campaigns)
require('dotenv').config();
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();
const SYSTEM_USER_ID = Number(process.env.SYSTEM_USER_ID || 1);

async function removeAllTemplatesWithoutMetrics() {
  console.log('Removing ALL templates without metrics...');
  console.log('⚠️  This will delete templates even if they are used by campaigns.');

  try {
    // Find templates that don't have any metrics
    const templatesWithoutMetrics = await prisma.messageTemplate.findMany({
      where: {
        ownerId: SYSTEM_USER_ID,
        conversionRate: null,
        productViewsIncrease: null,
        clickThroughRate: null,
        averageOrderValue: null,
        customerRetention: null,
      }
    });

    console.log(`Found ${templatesWithoutMetrics.length} templates without metrics.`);

    if (templatesWithoutMetrics.length === 0) {
      console.log('No templates to remove.');
      return;
    }

    // Check if any of these templates are used by campaigns
    const templateIds = templatesWithoutMetrics.map(t => t.id);
    const campaignsUsingTemplates = await prisma.campaign.findMany({
      where: {
        templateId: { in: templateIds }
      },
      select: { id: true, name: true, templateId: true }
    });

    const usedTemplateIds = [...new Set(campaignsUsingTemplates.map(c => c.templateId).filter(Boolean))];

    if (usedTemplateIds.length > 0) {
      console.log(`⚠️  Warning: ${usedTemplateIds.length} templates are in use by ${campaignsUsingTemplates.length} campaigns.`);
      console.log('   Updating campaigns to remove template references...');
      
      // Update campaigns to set templateId to null
      const updateResult = await prisma.campaign.updateMany({
        where: {
          templateId: { in: usedTemplateIds }
        },
        data: {
          templateId: null
        }
      });
      
      console.log(`   ✅ Updated ${updateResult.count} campaigns (removed template references).`);
      console.log('   Campaigns affected:');
      campaignsUsingTemplates.forEach(c => {
        console.log(`     - Campaign ID ${c.id}: ${c.name || 'Unnamed'} (Template ID: ${c.templateId})`);
      });
    }

    // Now delete ALL templates without metrics
    const deleteResult = await prisma.messageTemplate.deleteMany({
      where: {
        id: { in: templateIds }
      }
    });

    console.log(`✅ Deleted ${deleteResult.count} templates without metrics.`);

    if (usedTemplateIds.length > 0) {
      console.log(`\n⚠️  IMPORTANT: ${campaignsUsingTemplates.length} campaigns are now using deleted templates.`);
      console.log('   Please update these campaigns to use templates with metrics after running the seed script.');
    }

  } catch (error) {
    console.error('Error removing templates:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  removeAllTemplatesWithoutMetrics()
    .then(() => {
      console.log('Done!');
      process.exit(0);
    })
    .catch((error) => {
      console.error('Script failed:', error);
      process.exit(1);
    });
}

module.exports = { removeAllTemplatesWithoutMetrics };

