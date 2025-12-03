-- This migration removes metadata dependency and adds segmentation support
-- It's safe to run multiple times (uses IF NOT EXISTS / IF EXISTS)

-- Step 1: Remove metadata column from Contact (if exists - it shouldn't based on error)
ALTER TABLE "Contact" DROP COLUMN IF EXISTS "metadata";

-- Step 2: Ensure Gender enum exists
DO $$ 
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'Gender') THEN
    CREATE TYPE "Gender" AS ENUM ('male', 'female', 'other', 'prefer_not_to_say');
  END IF;
END $$;

-- Step 3: Add gender and birthday to Contact (safe if already exists)
ALTER TABLE "Contact" ADD COLUMN IF NOT EXISTS "gender" "Gender";
ALTER TABLE "Contact" ADD COLUMN IF NOT EXISTS "birthday" TIMESTAMP(3);

-- Step 4: Add indexes for gender and birthday (safe if already exists)
CREATE INDEX IF NOT EXISTS "Contact_gender_idx" ON "Contact"("gender");
CREATE INDEX IF NOT EXISTS "Contact_birthday_idx" ON "Contact"("birthday");
CREATE INDEX IF NOT EXISTS "Contact_ownerId_gender_idx" ON "Contact"("ownerId", "gender");

-- Step 5: Add segmentation filters to List (safe if already exists)
ALTER TABLE "List" ADD COLUMN IF NOT EXISTS "filterGender" "Gender";
ALTER TABLE "List" ADD COLUMN IF NOT EXISTS "filterAgeMin" INTEGER;
ALTER TABLE "List" ADD COLUMN IF NOT EXISTS "filterAgeMax" INTEGER;

-- Step 6: Add index for gender filtering (safe if already exists)
CREATE INDEX IF NOT EXISTS "List_ownerId_filterGender_idx" ON "List"("ownerId", "filterGender");

