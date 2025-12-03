-- Fix Automation table columns
-- Add missing columns if they don't exist

-- Check and add messageBody column if missing
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 
        FROM information_schema.columns 
        WHERE table_name = 'Automation' 
        AND column_name = 'messageBody'
    ) THEN
        ALTER TABLE "Automation" 
        ADD COLUMN "messageBody" TEXT NOT NULL DEFAULT 'Hello!';
    END IF;
END $$;

-- Check and add isActive column if missing
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 
        FROM information_schema.columns 
        WHERE table_name = 'Automation' 
        AND column_name = 'isActive'
    ) THEN
        ALTER TABLE "Automation" 
        ADD COLUMN "isActive" BOOLEAN NOT NULL DEFAULT false;
    END IF;
END $$;

-- Check and add createdAt column if missing
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 
        FROM information_schema.columns 
        WHERE table_name = 'Automation' 
        AND column_name = 'createdAt'
    ) THEN
        ALTER TABLE "Automation" 
        ADD COLUMN "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
    END IF;
END $$;

-- Check and add updatedAt column if missing
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 
        FROM information_schema.columns 
        WHERE table_name = 'Automation' 
        AND column_name = 'updatedAt'
    ) THEN
        ALTER TABLE "Automation" 
        ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
    END IF;
END $$;

-- Ensure updatedAt has proper trigger for auto-update
CREATE OR REPLACE FUNCTION update_automation_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW."updatedAt" = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS automation_updated_at ON "Automation";
CREATE TRIGGER automation_updated_at
    BEFORE UPDATE ON "Automation"
    FOR EACH ROW
    EXECUTE FUNCTION update_automation_updated_at();

