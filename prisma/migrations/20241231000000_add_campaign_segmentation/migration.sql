-- Migration: Add system-defined segmentation to Campaign model
-- This migration adds filterGender and filterAgeGroup fields to Campaign
-- and makes listId optional for backward compatibility

-- Step 1: Create AgeGroup enum
DO $$ 
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'AgeGroup') THEN
    CREATE TYPE "AgeGroup" AS ENUM ('age_18_24', 'age_25_39', 'age_40_plus');
  END IF;
END $$;

-- Step 2: Make listId optional (nullable)
ALTER TABLE "Campaign" ALTER COLUMN "listId" DROP NOT NULL;

-- Step 3: Add filterGender column (nullable, references Gender enum)
ALTER TABLE "Campaign" ADD COLUMN IF NOT EXISTS "filterGender" "Gender";

-- Step 4: Add filterAgeGroup column (nullable, references AgeGroup enum)
ALTER TABLE "Campaign" ADD COLUMN IF NOT EXISTS "filterAgeGroup" "AgeGroup";

-- Step 5: Add indexes for filtering
CREATE INDEX IF NOT EXISTS "Campaign_filterGender_idx" ON "Campaign"("filterGender");
CREATE INDEX IF NOT EXISTS "Campaign_filterAgeGroup_idx" ON "Campaign"("filterAgeGroup");

