-- Remove 'delivered' from MessageStatus enum
-- Map all existing 'delivered' records to 'sent' status

-- First, update all CampaignMessage records with status 'delivered' to 'sent'
UPDATE "CampaignMessage" 
SET "status" = 'sent' 
WHERE "status" = 'delivered';

-- Remove 'delivered' from the enum
-- Note: PostgreSQL doesn't support removing enum values directly, so we need to:
-- 1. Create a new enum without 'delivered'
-- 2. Alter the column to use the new enum (removing default first, then adding it back)
-- 3. Drop the old enum

-- Create new enum without 'delivered'
CREATE TYPE "MessageStatus_new" AS ENUM ('queued', 'sent', 'failed');

-- Remove default constraint temporarily
ALTER TABLE "CampaignMessage" 
  ALTER COLUMN "status" DROP DEFAULT;

-- Alter the column to use the new enum
ALTER TABLE "CampaignMessage" 
  ALTER COLUMN "status" TYPE "MessageStatus_new" 
  USING "status"::text::"MessageStatus_new";

-- Restore default value
ALTER TABLE "CampaignMessage" 
  ALTER COLUMN "status" SET DEFAULT 'queued'::"MessageStatus_new";

-- Drop the old enum
DROP TYPE "MessageStatus";

-- Rename the new enum to the original name
ALTER TYPE "MessageStatus_new" RENAME TO "MessageStatus";

