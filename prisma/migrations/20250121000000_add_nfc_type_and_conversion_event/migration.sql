-- CreateEnum
CREATE TYPE "public"."NfcTagType" AS ENUM ('opt_in', 'conversion');

-- Backfill MessageTemplate category for existing NULL values
UPDATE "public"."MessageTemplate" SET "category" = 'generic' WHERE "category" IS NULL;

-- Make MessageTemplate category required (if not already)
ALTER TABLE "public"."MessageTemplate" ALTER COLUMN "category" SET NOT NULL;
ALTER TABLE "public"."MessageTemplate" ALTER COLUMN "category" SET DEFAULT 'generic';

-- AlterTable
ALTER TABLE "public"."NfcTag" ADD COLUMN "type" "public"."NfcTagType" NOT NULL DEFAULT 'opt_in';

-- CreateTable
CREATE TABLE "public"."ConversionEvent" (
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

-- CreateIndex
CREATE INDEX "ConversionEvent_storeId_idx" ON "public"."ConversionEvent"("storeId");

-- CreateIndex
CREATE INDEX "ConversionEvent_campaignId_idx" ON "public"."ConversionEvent"("campaignId");

-- CreateIndex
CREATE INDEX "ConversionEvent_contactId_idx" ON "public"."ConversionEvent"("contactId");

-- CreateIndex
CREATE INDEX "ConversionEvent_nfcTagId_idx" ON "public"."ConversionEvent"("nfcTagId");

-- CreateIndex
CREATE INDEX "ConversionEvent_occurredAt_idx" ON "public"."ConversionEvent"("occurredAt");

-- CreateIndex
CREATE INDEX "ConversionEvent_storeId_campaignId_idx" ON "public"."ConversionEvent"("storeId", "campaignId");

-- CreateIndex
CREATE INDEX "NfcTag_type_idx" ON "public"."NfcTag"("type");

-- AddForeignKey
ALTER TABLE "public"."ConversionEvent" ADD CONSTRAINT "ConversionEvent_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ConversionEvent" ADD CONSTRAINT "ConversionEvent_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "public"."Contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ConversionEvent" ADD CONSTRAINT "ConversionEvent_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "public"."Campaign"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ConversionEvent" ADD CONSTRAINT "ConversionEvent_campaignMessageId_fkey" FOREIGN KEY ("campaignMessageId") REFERENCES "public"."CampaignMessage"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ConversionEvent" ADD CONSTRAINT "ConversionEvent_nfcTagId_fkey" FOREIGN KEY ("nfcTagId") REFERENCES "public"."NfcTag"("id") ON DELETE CASCADE ON UPDATE CASCADE;

