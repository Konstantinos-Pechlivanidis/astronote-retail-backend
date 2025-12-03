-- Create ConversionEvent table if it doesn't exist
-- This migration ensures the ConversionEvent table exists even if the previous migration didn't apply correctly

CREATE TABLE IF NOT EXISTS "public"."ConversionEvent" (
    "id" SERIAL NOT NULL,
    "storeId" INTEGER NOT NULL,
    "contactId" INTEGER NOT NULL,
    "campaignId" INTEGER,
    "campaignMessageId" INTEGER,
    "nfcTagId" INTEGER NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "metadata" JSONB,

    CONSTRAINT "ConversionEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex (only if they don't exist)
CREATE INDEX IF NOT EXISTS "ConversionEvent_storeId_idx" ON "public"."ConversionEvent"("storeId");
CREATE INDEX IF NOT EXISTS "ConversionEvent_campaignId_idx" ON "public"."ConversionEvent"("campaignId");
CREATE INDEX IF NOT EXISTS "ConversionEvent_contactId_idx" ON "public"."ConversionEvent"("contactId");
CREATE INDEX IF NOT EXISTS "ConversionEvent_nfcTagId_idx" ON "public"."ConversionEvent"("nfcTagId");
CREATE INDEX IF NOT EXISTS "ConversionEvent_occurredAt_idx" ON "public"."ConversionEvent"("occurredAt");
CREATE INDEX IF NOT EXISTS "ConversionEvent_storeId_campaignId_idx" ON "public"."ConversionEvent"("storeId", "campaignId");

-- AddForeignKey (only if they don't exist)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'ConversionEvent_storeId_fkey'
    ) THEN
        ALTER TABLE "public"."ConversionEvent" ADD CONSTRAINT "ConversionEvent_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
    
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'ConversionEvent_contactId_fkey'
    ) THEN
        ALTER TABLE "public"."ConversionEvent" ADD CONSTRAINT "ConversionEvent_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "public"."Contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
    
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'ConversionEvent_campaignId_fkey'
    ) THEN
        ALTER TABLE "public"."ConversionEvent" ADD CONSTRAINT "ConversionEvent_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "public"."Campaign"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
    
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'ConversionEvent_campaignMessageId_fkey'
    ) THEN
        ALTER TABLE "public"."ConversionEvent" ADD CONSTRAINT "ConversionEvent_campaignMessageId_fkey" FOREIGN KEY ("campaignMessageId") REFERENCES "public"."CampaignMessage"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
    
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'ConversionEvent_nfcTagId_fkey'
    ) THEN
        ALTER TABLE "public"."ConversionEvent" ADD CONSTRAINT "ConversionEvent_nfcTagId_fkey" FOREIGN KEY ("nfcTagId") REFERENCES "public"."NfcTag"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

