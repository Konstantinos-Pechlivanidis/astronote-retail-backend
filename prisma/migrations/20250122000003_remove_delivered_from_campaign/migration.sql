-- Remove 'delivered' column from Campaign table
-- We only track 'sent' and 'failed' now

ALTER TABLE "Campaign" DROP COLUMN IF EXISTS "delivered";

