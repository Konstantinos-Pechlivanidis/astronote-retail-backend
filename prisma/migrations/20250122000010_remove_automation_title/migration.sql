-- Remove title column from Automation table if it exists
-- The frontend uses hardcoded titles based on automation type, so this column is not needed

DO $$ 
BEGIN
    IF EXISTS (
        SELECT 1 
        FROM information_schema.columns 
        WHERE table_name = 'Automation' 
        AND column_name = 'title'
    ) THEN
        ALTER TABLE "Automation" 
        DROP COLUMN "title";
    END IF;
END $$;

