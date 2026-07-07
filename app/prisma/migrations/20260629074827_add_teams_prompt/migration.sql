-- CreateEnum
CREATE TYPE "PromptPhase" AS ENUM ('MORNING', 'EOD');

-- CreateTable
CREATE TABLE "TeamsPrompt" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "phase" "PromptPhase" NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "respondedAt" TIMESTAMP(3),

    CONSTRAINT "TeamsPrompt_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TeamsPrompt_date_phase_idx" ON "TeamsPrompt"("date", "phase");

-- CreateIndex
CREATE UNIQUE INDEX "TeamsPrompt_userId_date_phase_key" ON "TeamsPrompt"("userId", "date", "phase");

-- AddForeignKey
ALTER TABLE "TeamsPrompt" ADD CONSTRAINT "TeamsPrompt_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
