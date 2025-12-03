-- Final synchronization: Ensure Automation table matches Prisma schema exactly
-- This migration handles any remaining inconsistencies

DO $$ 
BEGIN
    -- Remove any columns that shouldn't exist (except the ones we need)
    -- List of valid columns: id, ownerId, type, isActive, messageBody, createdAt, updatedAt
    
    -- Remove 'title' if it exists
    IF EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'Automation' AND column_name = 'title'
    ) THEN
        ALTER TABLE "Automation" DROP COLUMN "title";
    END IF;
    
    -- Remove 'message' if it exists (should be messageBody)
    IF EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'Automation' AND column_name = 'message'
    ) THEN
        -- If messageBody doesn't exist, rename message to messageBody
        IF NOT EXISTS (
            SELECT 1 FROM information_schema.columns 
            WHERE table_name = 'Automation' AND column_name = 'messageBody'
        ) THEN
            ALTER TABLE "Automation" RENAME COLUMN "message" TO "messageBody";
        ELSE
            -- Copy data and drop message
            UPDATE "Automation" 
            SET "messageBody" = COALESCE("messageBody", "message")
            WHERE "messageBody" IS NULL OR "messageBody" = '';
            ALTER TABLE "Automation" DROP COLUMN "message";
        END IF;
    END IF;
    
    -- Ensure all required columns exist with correct defaults
    -- ownerId
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'Automation' AND column_name = 'ownerId'
    ) THEN
        ALTER TABLE "Automation" ADD COLUMN "ownerId" INTEGER NOT NULL;
    END IF;
    
    -- type
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'Automation' AND column_name = 'type'
    ) THEN
        ALTER TABLE "Automation" ADD COLUMN "type" "AutomationType" NOT NULL DEFAULT 'welcome_message';
    END IF;
    
    -- isActive
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'Automation' AND column_name = 'isActive'
    ) THEN
        ALTER TABLE "Automation" ADD COLUMN "isActive" BOOLEAN NOT NULL DEFAULT false;
    END IF;
    
    -- messageBody (ensure it exists and has default)
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'Automation' AND column_name = 'messageBody'
    ) THEN
        ALTER TABLE "Automation" ADD COLUMN "messageBody" TEXT NOT NULL DEFAULT 'Hello!';
    ELSE
        -- Update NULL values
        UPDATE "Automation" SET "messageBody" = 'Hello!' WHERE "messageBody" IS NULL;
        -- Ensure NOT NULL
        ALTER TABLE "Automation" ALTER COLUMN "messageBody" SET NOT NULL;
        ALTER TABLE "Automation" ALTER COLUMN "messageBody" SET DEFAULT 'Hello!';
    END IF;
    
    -- createdAt
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'Automation' AND column_name = 'createdAt'
    ) THEN
        ALTER TABLE "Automation" ADD COLUMN "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
    END IF;
    
    -- updatedAt
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'Automation' AND column_name = 'updatedAt'
    ) THEN
        ALTER TABLE "Automation" ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
    END IF;
END $$;

