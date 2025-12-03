-- AlterTable
ALTER TABLE "public"."Package" ADD COLUMN "stripePriceIdEur" VARCHAR(255),
ADD COLUMN "stripePriceIdUsd" VARCHAR(255);

-- CreateIndex
CREATE INDEX "Package_stripePriceIdEur_idx" ON "public"."Package"("stripePriceIdEur");

-- CreateIndex
CREATE INDEX "Package_stripePriceIdUsd_idx" ON "public"."Package"("stripePriceIdUsd");

