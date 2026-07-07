-- CreateEnum
CREATE TYPE "DeferralCause" AS ENUM ('INTERRUPTED', 'UNDERESTIMATED', 'BLOCKED', 'DEPRIORITIZED', 'OTHER');

-- AlterTable
ALTER TABLE "DailyTask" ADD COLUMN     "deferralCause" "DeferralCause",
ADD COLUMN     "deferralNote" TEXT,
ADD COLUMN     "deferredFromDate" DATE,
ADD COLUMN     "deferredToDate" DATE;
