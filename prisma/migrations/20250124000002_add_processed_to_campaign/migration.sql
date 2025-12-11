-- AlterTable: Add processed field to Campaign (Phase 2.2)
-- processed = sent + failed (optional, can be calculated on-the-fly)
ALTER TABLE "Campaign" ADD COLUMN "processed" INTEGER;

-- Note: processed can be calculated as sent + failed, so we don't set a default
-- The application will calculate and update this field when updating campaign aggregates

