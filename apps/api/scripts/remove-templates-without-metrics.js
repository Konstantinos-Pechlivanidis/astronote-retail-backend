// apps/api/scripts/remove-templates-without-metrics.js
// Remove templates that don't have any metrics (duplicates)
require('dotenv').config();
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();
const SYSTEM_USER_ID = Number(process.env.SYSTEM_USER_ID || 1);

async function removeTemplatesWithoutMetrics() {
  console.log('Removing templates without metrics...');

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
      select: { templateId: true }
    });

    const usedTemplateIds = [...new Set(campaignsUsingTemplates.map(c => c.templateId).filter(Boolean))];
    const unusedTemplateIds = templateIds.filter(id => !usedTemplateIds.includes(id));

    console.log(`Templates in use by campaigns: ${usedTemplateIds.length}`);
    console.log(`Templates safe to delete: ${unusedTemplateIds.length}`);

    if (unusedTemplateIds.length > 0) {
      // Delete only templates that are not in use
      const deleteResult = await prisma.messageTemplate.deleteMany({
        where: {
          id: { in: unusedTemplateIds }
        }
      });

      console.log(`✅ Deleted ${deleteResult.count} templates without metrics.`);
    }

    if (usedTemplateIds.length > 0) {
      console.log(`⚠️  ${usedTemplateIds.length} templates are in use by campaigns and were kept.`);
      console.log('   Consider updating these campaigns to use templates with metrics.');
    }

  } catch (error) {
    console.error('Error removing templates:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  removeTemplatesWithoutMetrics()
    .then(() => {
      console.log('Done!');
      process.exit(0);
    })
    .catch((error) => {
      console.error('Script failed:', error);
      process.exit(1);
    });
}

module.exports = { removeTemplatesWithoutMetrics };

