-- AlterTable
ALTER TABLE "CampaignMessage" ADD COLUMN "bulkId" TEXT;

-- CreateIndex
CREATE INDEX "CampaignMessage_bulkId_idx" ON "CampaignMessage"("bulkId");

