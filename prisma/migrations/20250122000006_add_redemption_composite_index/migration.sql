-- Add composite index on Redemption(ownerId, campaignId) for optimized stats queries
CREATE INDEX IF NOT EXISTS "Redemption_ownerId_campaignId_idx" ON "Redemption"("ownerId", "campaignId");

