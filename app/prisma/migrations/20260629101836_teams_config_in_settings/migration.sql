-- AlterTable
ALTER TABLE "AppSettings" ADD COLUMN     "teamsEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "teamsFlowUrl" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "teamsSharedSecret" TEXT NOT NULL DEFAULT '';
