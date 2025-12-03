-- Migration: Add language field to MessageTemplate for i18n support
-- This migration adds language field with default value "en" and creates an index

-- Step 1: Add language column with default value
ALTER TABLE "MessageTemplate" ADD COLUMN IF NOT EXISTS "language" TEXT NOT NULL DEFAULT 'en';

-- Step 2: Add index for language filtering
CREATE INDEX IF NOT EXISTS "MessageTemplate_language_idx" ON "MessageTemplate"("language");

