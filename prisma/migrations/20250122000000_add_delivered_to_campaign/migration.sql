-- Add missing `delivered` column to Campaign table
-- This column exists in the Prisma schema but was missing from the database

ALTER TABLE "Campaign" 
ADD COLUMN IF NOT EXISTS "delivered" INTEGER NOT NULL DEFAULT 0;

