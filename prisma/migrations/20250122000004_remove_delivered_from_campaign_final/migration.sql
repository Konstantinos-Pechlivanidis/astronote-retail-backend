-- Remove 'delivered' column from Campaign table (final cleanup)
-- This field was removed from usage but column still existed in schema

ALTER TABLE "Campaign" DROP COLUMN IF EXISTS "delivered";

