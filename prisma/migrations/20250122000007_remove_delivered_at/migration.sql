-- Remove deliveredAt column and its index from CampaignMessage
-- "Delivered" status from Mitto is now mapped to "sent" internally

-- Drop index first
DROP INDEX IF EXISTS "CampaignMessage_deliveredAt_idx";

-- Drop column
ALTER TABLE "CampaignMessage" DROP COLUMN IF EXISTS "deliveredAt";

