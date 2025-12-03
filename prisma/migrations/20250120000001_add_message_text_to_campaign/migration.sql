-- Migration: Add messageText field to Campaign model
-- This field stores optional custom message text that overrides template text

ALTER TABLE "Campaign" ADD COLUMN IF NOT EXISTS "messageText" TEXT;

