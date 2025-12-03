-- Verify and fix Automation table structure
-- This migration ensures the table matches the Prisma schema exactly

-- Ensure all required columns exist with correct types and constraints
DO $$ 
BEGIN
    -- Verify id column (should already exist as primary key)
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'Automation' AND column_name = 'id'
    ) THEN
        RAISE EXCEPTION 'Automation table missing id column';
    END IF;

    -- Verify ownerId column
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'Automation' AND column_name = 'ownerId'
    ) THEN
        ALTER TABLE "Automation" ADD COLUMN "ownerId" INTEGER NOT NULL;
    END IF;

    -- Verify type column
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'Automation' AND column_name = 'type'
    ) THEN
        ALTER TABLE "Automation" ADD COLUMN "type" "AutomationType" NOT NULL DEFAULT 'welcome_message';
    END IF;

    -- Verify isActive column
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'Automation' AND column_name = 'isActive'
    ) THEN
        ALTER TABLE "Automation" ADD COLUMN "isActive" BOOLEAN NOT NULL DEFAULT false;
    END IF;

    -- Verify messageBody column
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'Automation' AND column_name = 'messageBody'
    ) THEN
        ALTER TABLE "Automation" ADD COLUMN "messageBody" TEXT NOT NULL DEFAULT 'Hello!';
    END IF;

    -- Verify createdAt column
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'Automation' AND column_name = 'createdAt'
    ) THEN
        ALTER TABLE "Automation" ADD COLUMN "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
    END IF;

    -- Verify updatedAt column
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'Automation' AND column_name = 'updatedAt'
    ) THEN
        ALTER TABLE "Automation" ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
    END IF;

    -- Ensure title column is removed (if it exists)
    IF EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'Automation' AND column_name = 'title'
    ) THEN
        ALTER TABLE "Automation" DROP COLUMN "title";
    END IF;
END $$;

-- Ensure foreign key exists
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint 
        WHERE conname = 'Automation_ownerId_fkey'
    ) THEN
        ALTER TABLE "Automation" 
        ADD CONSTRAINT "Automation_ownerId_fkey" 
        FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

-- Ensure unique constraint exists
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_indexes 
        WHERE indexname = 'Automation_ownerId_type_key'
    ) THEN
        -- Remove duplicates first
        DELETE FROM "Automation" a1
        WHERE EXISTS (
            SELECT 1 FROM "Automation" a2 
            WHERE a2."ownerId" = a1."ownerId" 
            AND a2."type" = a1."type"
            AND a2."id" < a1."id"
        );
        
        CREATE UNIQUE INDEX "Automation_ownerId_type_key" ON "Automation"("ownerId", "type");
    END IF;
END $$;

-- Ensure indexes exist
CREATE INDEX IF NOT EXISTS "Automation_ownerId_idx" ON "Automation"("ownerId");
CREATE INDEX IF NOT EXISTS "Automation_ownerId_isActive_idx" ON "Automation"("ownerId", "isActive");
CREATE INDEX IF NOT EXISTS "Automation_type_idx" ON "Automation"("type");

