-- Migration: Add metadata fields to MessageTemplate for system template library
-- This migration adds category, goal, and suggestedMetrics fields

-- Step 1: Create TemplateCategory enum
DO $$ 
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'TemplateCategory') THEN
    CREATE TYPE "TemplateCategory" AS ENUM ('cafe', 'restaurant', 'gym', 'sports_club', 'generic');
  END IF;
END $$;

-- Step 2: Add category column (nullable for backward compatibility)
ALTER TABLE "MessageTemplate" ADD COLUMN IF NOT EXISTS "category" "TemplateCategory";

-- Step 3: Add goal column (nullable)
ALTER TABLE "MessageTemplate" ADD COLUMN IF NOT EXISTS "goal" VARCHAR(200);

-- Step 4: Add suggestedMetrics column (nullable)
ALTER TABLE "MessageTemplate" ADD COLUMN IF NOT EXISTS "suggestedMetrics" VARCHAR(500);

-- Step 5: Add index for category filtering
CREATE INDEX IF NOT EXISTS "MessageTemplate_category_idx" ON "MessageTemplate"("category");

