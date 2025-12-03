-- Create OfferViewEvent table for optional analytics (offer view/click tracking)
CREATE TABLE "OfferViewEvent" (
    "id" SERIAL NOT NULL,
    "campaignMessageId" INTEGER NOT NULL,
    "campaignId" INTEGER NOT NULL,
    "contactId" INTEGER NOT NULL,
    "ownerId" INTEGER NOT NULL,
    "ipAddress" VARCHAR(45),
    "userAgent" VARCHAR(500),
    "deviceType" VARCHAR(50),
    "viewedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OfferViewEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OfferViewEvent_campaignMessageId_idx" ON "OfferViewEvent"("campaignMessageId");
CREATE INDEX "OfferViewEvent_campaignId_idx" ON "OfferViewEvent"("campaignId");
CREATE INDEX "OfferViewEvent_contactId_idx" ON "OfferViewEvent"("contactId");
CREATE INDEX "OfferViewEvent_ownerId_idx" ON "OfferViewEvent"("ownerId");
CREATE INDEX "OfferViewEvent_viewedAt_idx" ON "OfferViewEvent"("viewedAt");
CREATE INDEX "OfferViewEvent_ownerId_campaignId_idx" ON "OfferViewEvent"("ownerId", "campaignId");

-- AddForeignKey
ALTER TABLE "OfferViewEvent" ADD CONSTRAINT "OfferViewEvent_campaignMessageId_fkey" FOREIGN KEY ("campaignMessageId") REFERENCES "CampaignMessage"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OfferViewEvent" ADD CONSTRAINT "OfferViewEvent_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OfferViewEvent" ADD CONSTRAINT "OfferViewEvent_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OfferViewEvent" ADD CONSTRAINT "OfferViewEvent_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

