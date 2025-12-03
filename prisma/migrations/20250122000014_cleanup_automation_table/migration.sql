-- Complete cleanup of Automation table
-- Remove all columns that don't exist in Prisma schema
-- Ensure only the required columns exist: id, ownerId, type, isActive, messageBody, createdAt, updatedAt

DO $$ 
DECLARE
    col_name text;
    valid_columns text[] := ARRAY['id', 'ownerId', 'type', 'isActive', 'messageBody', 'createdAt', 'updatedAt'];
BEGIN
    -- Get all columns in Automation table
    FOR col_name IN 
        SELECT column_name 
        FROM information_schema.columns 
        WHERE table_name = 'Automation'
    LOOP
        -- If column is not in valid list, drop it
        IF NOT (col_name = ANY(valid_columns)) THEN
            EXECUTE format('ALTER TABLE "Automation" DROP COLUMN IF EXISTS %I', col_name);
            RAISE NOTICE 'Dropped column: %', col_name;
        END IF;
    END LOOP;
END $$;

-- Now ensure all required columns exist with correct types and defaults
DO $$ 
BEGIN
    -- Ensure ownerId exists
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'Automation' AND column_name = 'ownerId'
    ) THEN
        ALTER TABLE "Automation" ADD COLUMN "ownerId" INTEGER NOT NULL;
    END IF;
    
    -- Ensure type exists
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'Automation' AND column_name = 'type'
    ) THEN
        -- Create enum if it doesn't exist
        IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'AutomationType') THEN
            CREATE TYPE "AutomationType" AS ENUM ('welcome_message', 'birthday_message');
        END IF;
        ALTER TABLE "Automation" ADD COLUMN "type" "AutomationType" NOT NULL DEFAULT 'welcome_message';
    END IF;
    
    -- Ensure isActive exists
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'Automation' AND column_name = 'isActive'
    ) THEN
        ALTER TABLE "Automation" ADD COLUMN "isActive" BOOLEAN NOT NULL DEFAULT false;
    END IF;
    
    -- Ensure messageBody exists
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'Automation' AND column_name = 'messageBody'
    ) THEN
        ALTER TABLE "Automation" ADD COLUMN "messageBody" TEXT NOT NULL DEFAULT 'Hello!';
    ELSE
        -- Update NULL values and ensure NOT NULL
        UPDATE "Automation" SET "messageBody" = 'Hello!' WHERE "messageBody" IS NULL;
        ALTER TABLE "Automation" ALTER COLUMN "messageBody" SET NOT NULL;
        ALTER TABLE "Automation" ALTER COLUMN "messageBody" SET DEFAULT 'Hello!';
    END IF;
    
    -- Ensure createdAt exists
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'Automation' AND column_name = 'createdAt'
    ) THEN
        ALTER TABLE "Automation" ADD COLUMN "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
    END IF;
    
    -- Ensure updatedAt exists
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'Automation' AND column_name = 'updatedAt'
    ) THEN
        ALTER TABLE "Automation" ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
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

-- Remove duplicates and ensure unique constraint
DO $$
BEGIN
    -- Remove duplicates (keep oldest)
    DELETE FROM "Automation" a1
    WHERE EXISTS (
        SELECT 1 FROM "Automation" a2 
        WHERE a2."ownerId" = a1."ownerId" 
        AND a2."type" = a1."type"
        AND a2."id" < a1."id"
    );
    
    -- Create unique index if it doesn't exist
    IF NOT EXISTS (
        SELECT 1 FROM pg_indexes 
        WHERE indexname = 'Automation_ownerId_type_key'
    ) THEN
        CREATE UNIQUE INDEX "Automation_ownerId_type_key" ON "Automation"("ownerId", "type");
    END IF;
END $$;

-- Ensure all indexes exist
CREATE INDEX IF NOT EXISTS "Automation_ownerId_idx" ON "Automation"("ownerId");
CREATE INDEX IF NOT EXISTS "Automation_ownerId_isActive_idx" ON "Automation"("ownerId", "isActive");
CREATE INDEX IF NOT EXISTS "Automation_type_idx" ON "Automation"("type");

-- Ensure updatedAt trigger exists
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

