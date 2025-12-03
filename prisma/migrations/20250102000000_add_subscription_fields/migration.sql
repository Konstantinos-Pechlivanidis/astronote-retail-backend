-- CreateEnum
CREATE TYPE "public"."SubscriptionPlanType" AS ENUM ('starter', 'pro');

-- CreateEnum
CREATE TYPE "public"."SubscriptionStatus" AS ENUM ('active', 'inactive', 'cancelled');

-- AlterTable
ALTER TABLE "public"."User" ADD COLUMN "stripeCustomerId" VARCHAR(255),
ADD COLUMN "stripeSubscriptionId" VARCHAR(255),
ADD COLUMN "planType" "public"."SubscriptionPlanType",
ADD COLUMN "subscriptionStatus" "public"."SubscriptionStatus" NOT NULL DEFAULT 'inactive',
ADD COLUMN "lastFreeCreditsAllocatedAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "User_stripeCustomerId_idx" ON "public"."User"("stripeCustomerId");

-- CreateIndex
CREATE INDEX "User_stripeSubscriptionId_idx" ON "public"."User"("stripeSubscriptionId");

-- CreateIndex
CREATE INDEX "User_subscriptionStatus_idx" ON "public"."User"("subscriptionStatus");

