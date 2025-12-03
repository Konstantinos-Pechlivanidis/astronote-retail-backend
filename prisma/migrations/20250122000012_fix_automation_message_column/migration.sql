-- Fix Automation table: handle message vs messageBody column mismatch
-- The Prisma schema uses 'messageBody' but the database might have 'message'

DO $$ 
BEGIN
    -- If 'message' column exists but 'messageBody' doesn't, rename it
    IF EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'Automation' AND column_name = 'message'
    ) AND NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'Automation' AND column_name = 'messageBody'
    ) THEN
        ALTER TABLE "Automation" 
        RENAME COLUMN "message" TO "messageBody";
    END IF;
    
    -- If both exist, copy data from 'message' to 'messageBody' and drop 'message'
    IF EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'Automation' AND column_name = 'message'
    ) AND EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'Automation' AND column_name = 'messageBody'
    ) THEN
        UPDATE "Automation" 
        SET "messageBody" = COALESCE("messageBody", "message")
        WHERE "messageBody" IS NULL OR "messageBody" = '';
        
        ALTER TABLE "Automation" DROP COLUMN "message";
    END IF;
    
    -- If only 'message' exists, rename it
    IF EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'Automation' AND column_name = 'message'
    ) THEN
        ALTER TABLE "Automation" 
        RENAME COLUMN "message" TO "messageBody";
    END IF;
    
    -- Ensure messageBody column exists with correct type and default
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'Automation' AND column_name = 'messageBody'
    ) THEN
        ALTER TABLE "Automation" 
        ADD COLUMN "messageBody" TEXT NOT NULL DEFAULT 'Hello!';
    ELSE
        -- Update existing messageBody to have default if NULL
        UPDATE "Automation" 
        SET "messageBody" = 'Hello!' 
        WHERE "messageBody" IS NULL OR "messageBody" = '';
        
        -- Ensure NOT NULL constraint
        ALTER TABLE "Automation" 
        ALTER COLUMN "messageBody" SET NOT NULL,
        ALTER COLUMN "messageBody" SET DEFAULT 'Hello!';
    END IF;
END $$;

