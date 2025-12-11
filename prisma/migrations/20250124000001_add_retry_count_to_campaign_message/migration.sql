-- Add retryCount column to CampaignMessage for idempotency tracking
ALTER TABLE "CampaignMessage" ADD COLUMN "retryCount" INTEGER NOT NULL DEFAULT 0;

-- Add index for retry count queries (optional, for monitoring)
CREATE INDEX IF NOT EXISTS "CampaignMessage_retryCount_idx" ON "CampaignMessage"("retryCount") WHERE "retryCount" > 0;

