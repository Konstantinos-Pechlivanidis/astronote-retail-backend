-- Add hotels category to TemplateCategory enum
ALTER TYPE "TemplateCategory" ADD VALUE IF NOT EXISTS 'hotels';

-- Add statistics fields to MessageTemplate
ALTER TABLE "MessageTemplate" ADD COLUMN IF NOT EXISTS "conversionRate" DOUBLE PRECISION;
ALTER TABLE "MessageTemplate" ADD COLUMN IF NOT EXISTS "productViewsIncrease" DOUBLE PRECISION;
ALTER TABLE "MessageTemplate" ADD COLUMN IF NOT EXISTS "clickThroughRate" DOUBLE PRECISION;
ALTER TABLE "MessageTemplate" ADD COLUMN IF NOT EXISTS "averageOrderValue" DOUBLE PRECISION;
ALTER TABLE "MessageTemplate" ADD COLUMN IF NOT EXISTS "customerRetention" DOUBLE PRECISION;

