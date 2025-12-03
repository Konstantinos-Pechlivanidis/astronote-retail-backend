-- CreateTable
CREATE TABLE "public"."AutomationMessage" (
    "id" SERIAL NOT NULL,
    "ownerId" INTEGER NOT NULL,
    "automationId" INTEGER NOT NULL,
    "contactId" INTEGER NOT NULL,
    "to" TEXT NOT NULL,
    "text" TEXT NOT NULL DEFAULT '',
    "trackingId" TEXT NOT NULL,
    "status" "MessageStatus" NOT NULL DEFAULT 'queued',
    "providerMessageId" TEXT,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" TIMESTAMP(3),
    "failedAt" TIMESTAMP(3),

    CONSTRAINT "AutomationMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."AutomationRedemption" (
    "messageId" INTEGER NOT NULL,
    "automationId" INTEGER NOT NULL,
    "contactId" INTEGER NOT NULL,
    "ownerId" INTEGER NOT NULL,
    "redeemedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "redeemedByUserId" INTEGER,
    "evidenceJson" JSONB,

    CONSTRAINT "AutomationRedemption_pkey" PRIMARY KEY ("messageId")
);

-- CreateIndex
CREATE UNIQUE INDEX "AutomationMessage_trackingId_key" ON "public"."AutomationMessage"("trackingId");

-- CreateIndex
CREATE INDEX "AutomationMessage_automationId_idx" ON "public"."AutomationMessage"("automationId");

-- CreateIndex
CREATE INDEX "AutomationMessage_contactId_idx" ON "public"."AutomationMessage"("contactId");

-- CreateIndex
CREATE INDEX "AutomationMessage_status_idx" ON "public"."AutomationMessage"("status");

-- CreateIndex
CREATE INDEX "AutomationMessage_providerMessageId_idx" ON "public"."AutomationMessage"("providerMessageId");

-- CreateIndex
CREATE INDEX "AutomationMessage_ownerId_idx" ON "public"."AutomationMessage"("ownerId");

-- CreateIndex
CREATE INDEX "AutomationMessage_sentAt_idx" ON "public"."AutomationMessage"("sentAt");

-- CreateIndex
CREATE INDEX "AutomationMessage_failedAt_idx" ON "public"."AutomationMessage"("failedAt");

-- CreateIndex
CREATE INDEX "AutomationMessage_ownerId_automationId_idx" ON "public"."AutomationMessage"("ownerId", "automationId");

-- CreateIndex
CREATE INDEX "AutomationMessage_ownerId_status_idx" ON "public"."AutomationMessage"("ownerId", "status");

-- CreateIndex
CREATE INDEX "AutomationRedemption_automationId_idx" ON "public"."AutomationRedemption"("automationId");

-- CreateIndex
CREATE INDEX "AutomationRedemption_contactId_idx" ON "public"."AutomationRedemption"("contactId");

-- CreateIndex
CREATE INDEX "AutomationRedemption_ownerId_idx" ON "public"."AutomationRedemption"("ownerId");

-- CreateIndex
CREATE INDEX "AutomationRedemption_ownerId_automationId_idx" ON "public"."AutomationRedemption"("ownerId", "automationId");

-- AddForeignKey
ALTER TABLE "public"."AutomationMessage" ADD CONSTRAINT "AutomationMessage_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."AutomationMessage" ADD CONSTRAINT "AutomationMessage_automationId_fkey" FOREIGN KEY ("automationId") REFERENCES "public"."Automation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."AutomationMessage" ADD CONSTRAINT "AutomationMessage_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "public"."Contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."AutomationRedemption" ADD CONSTRAINT "AutomationRedemption_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "public"."AutomationMessage"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."AutomationRedemption" ADD CONSTRAINT "AutomationRedemption_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

