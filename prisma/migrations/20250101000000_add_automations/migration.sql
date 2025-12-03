-- CreateEnum
CREATE TYPE "AutomationType" AS ENUM ('welcome_message', 'birthday_message');

-- CreateTable
CREATE TABLE "Automation" (
    "id" SERIAL NOT NULL,
    "ownerId" INTEGER NOT NULL,
    "type" "AutomationType" NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "messageBody" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Automation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Automation_ownerId_type_key" ON "Automation"("ownerId", "type");

-- CreateIndex
CREATE INDEX "Automation_ownerId_idx" ON "Automation"("ownerId");

-- CreateIndex
CREATE INDEX "Automation_ownerId_isActive_idx" ON "Automation"("ownerId", "isActive");

-- CreateIndex
CREATE INDEX "Automation_type_idx" ON "Automation"("type");

-- AddForeignKey
ALTER TABLE "Automation" ADD CONSTRAINT "Automation_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

