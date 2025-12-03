-- Check if AutomationType enum exists, if not create it
DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'AutomationType') THEN
        CREATE TYPE "AutomationType" AS ENUM ('welcome_message', 'birthday_message');
    END IF;
END $$;

-- Check if type column exists, if not add it
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 
        FROM information_schema.columns 
        WHERE table_name = 'Automation' 
        AND column_name = 'type'
    ) THEN
        -- Add type column with default value (nullable first)
        ALTER TABLE "Automation" 
        ADD COLUMN "type" "AutomationType";
        
        -- Set default value for existing records
        UPDATE "Automation" SET "type" = 'welcome_message' WHERE "type" IS NULL;
        
        -- Make it NOT NULL now
        ALTER TABLE "Automation" 
        ALTER COLUMN "type" SET NOT NULL,
        ALTER COLUMN "type" SET DEFAULT 'welcome_message';
        
        -- Remove duplicates before creating unique constraint
        -- Keep the oldest record for each (ownerId, type) combination
        DELETE FROM "Automation" a1
        WHERE EXISTS (
            SELECT 1 
            FROM "Automation" a2 
            WHERE a2."ownerId" = a1."ownerId" 
            AND a2."type" = a1."type"
            AND a2."id" < a1."id"
        );
        
        -- Create unique constraint if it doesn't exist
        IF NOT EXISTS (
            SELECT 1 
            FROM pg_constraint 
            WHERE conname = 'Automation_ownerId_type_key'
        ) THEN
            CREATE UNIQUE INDEX "Automation_ownerId_type_key" ON "Automation"("ownerId", "type");
        END IF;
        
        -- Create index on type if it doesn't exist
        IF NOT EXISTS (
            SELECT 1 
            FROM pg_indexes 
            WHERE indexname = 'Automation_type_idx'
        ) THEN
            CREATE INDEX "Automation_type_idx" ON "Automation"("type");
        END IF;
    END IF;
END $$;

